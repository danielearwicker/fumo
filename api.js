var fumo = (function() {

    function ShouldQuitError() {
        this.message = "Stopped by user";
    }

    ShouldQuitError.prototype = new Error();

    function wrapCheckShouldQuit(on) {
        return function(ctx) {
            if (ctx.shouldQuit) {
                return webdriver.promise.rejected(new ShouldQuitError());
            }
            return on(ctx);
        };
    }

    function normaliseString(str) {
        return str.toLowerCase().trim().replace(/\r/g, '');
    }

    function until(ctx, promisedTruthy) {
        var d = webdriver.promise.defer();
        var attempt = function() {
            if (ctx.shouldQuit) {
                d.reject(new ShouldQuitError());
            } else {
                promisedTruthy().then(function(result) {
                    if (result) {
                        d.fulfill(result);
                    } else {
                        setTimeout(attempt, 500);
                    }
                }, function(x) {
                    if (x instanceof ShouldQuitError) {
                        d.reject(x);
                    }
                    setTimeout(attempt, 500);
                });
            }
        };
        attempt();
        return d;
    }

    function retry(ctx, promisedOperation) {
        var d = webdriver.promise.defer();
        var tries = 0;
        var attempt = function() {
            if (ctx.shouldQuit) {
                d.reject(new ShouldQuitError());
            } else {
                promisedOperation(tries + 1).then(function(result) {
                    d.fulfill(result);
                }, function(x) {
                    if (x instanceof ShouldQuitError) {
                        d.reject(x);
                    }
                    if (tries++ > 10) {
                        d.reject(x);
                    } else {
                        setTimeout(attempt, 50);
                    }
                });
            }
        };
        attempt();
        return d;
    }

    function forEach(ctx, arr, act) {
        var d = webdriver.promise.defer(), i = 0, results = [];
        var step = function() {
            if (ctx.shouldQuit) {
                d.reject(new ShouldQuitError());
            } else {
                if (i >= arr.length) {
                    d.fulfill(results);
                } else {
                    var n = i++;
                    act(arr[n]).then(function(result) {
                        results[n] = result;
                        step();
                    }, function(err) {
                        d.reject(err);
                    });
                }
            }
        };
        step();
        return d;
    }

    function awaitElement(ctx, path) {

        ctx.log('Finding ' + JSON.stringify(path));

        if (!Array.isArray(path)) {
            path = [path];
        }

        path = path.map(function(part) {
            if (typeof part === 'string') {
                return webdriver.By.css(part);
            }
            if (part.css) {
                return webdriver.By.css(part.css);
            }
            if (part.xpath) {
                return webdriver.By.xpath(part.xpath);
            }
        });

        return retry(ctx, function() {

            var found = ctx.driver;

            return forEach(ctx, path, function(part) {
                return found.isElementPresent(part).then(function(present) {
                    if (!present) {
                        ctx.log('Not found: ' + JSON.stringify(path));
                        throw new Error('Could not find: ' + JSON.stringify(path));
                    }
                    return found.findElement(part).then(function(elem) {
                        found = elem;
                    });
                });
            }).then(function(results) {
                return found;
            });
        });
    }

    function extension_Delayed() {
        var on = this;
        return action(function(ctx) {
            ctx.log("Waiting a second");
            return webdriver.promise.delayed(1000).then(function() {
                return on(ctx);
            });
        });
    }

    function extension_Then(next) {
        var on = this;
        return action(function(ctx) {
            return on(ctx).then(function() {
                return next(ctx);
            });
        });
    }

    function action(on) {
        var ext = wrapCheckShouldQuit(on);
        ext.delayed = extension_Delayed;
        ext.then = extension_Then;
        return ext;
    }

    action.click = function(cssElem) {
        return action(function(ctx) {
            ctx.log('Clicking ' + cssElem);
            return awaitElement(ctx, cssElem).then(function(elem) {
                return elem.click();
            });
        });
    };

    action.inputText = function(cssElem, text, extraKeys) {
        return action(function(ctx) {
            ctx.log('Entering text "' + text + '" into ' + cssElem);
            return awaitElement(ctx, cssElem).then(function(elem) {
                var chain = elem.clear().then(function() {
                    return elem.sendKeys(text);
                });
                return extraKeys === false ? chain : chain.then(function() {
                    return elem.sendKeys(webdriver.Key.HOME)
                }).then(function() {
                    return elem.sendKeys(webdriver.Key.END)
                });
            });
        });
    };

    action.sendKeys = function(keyArray) {
        if (!Array.isArray(keyArray)) {
            keyArray = [keyArray];
        }
        return action(function(ctx) {
            return forEach(ctx, keyArray, function(key) {
                ctx.log('Pressing key "' + key + '"');
                var keyStr = webdriver.Key[key.toUpperCase()];
                if (keyStr === void 0) {
                    throw new Error('SendKeys: Invalid key name: ' + key);
                }
                return new webdriver.ActionSequence(ctx.driver)
                    .sendKeys(keyStr)
                    .perform();
            });
        });
    };

    action.navigate = function(url) {
        return action(function(ctx) {
            ctx.log('Navigating to ' + url);
            return ctx.driver.get(url);
        });
    };

    action.withFrame = function(frameCss, on) {
        return action(function(ctx) {
            ctx.log("Switching to frame " + frameCss);
            return awaitElement(ctx, frameCss).then(function(frameElem) {
                return ctx.driver.switchTo().frame(frameElem).then(function() {
                    return on(ctx).then(function(result) {
                        return ctx.driver.switchTo().defaultContent().then(function() {
                            return result;
                        });
                    }, function(err) {
                        return ctx.driver.switchTo().defaultContent().then(function() {
                            throw err;
                        });
                    });
                });
            });
        });
    };

    action.execute = function(js) {
        return action(function(ctx) {
            ctx.log('Executing: ' + js);
            return ctx.driver.executeScript(js);
        });
    };

    action.setProperty = function(css, prop, val) {
        return action.execute("$('" + css + "')." + prop + "(" + JSON.stringify(val) + ")");
    };

    action.moveTo = function(cssElem) {
        return action(function(ctx) {
            ctx.log('Moving mouse to: ' + cssElem);
            return awaitElement(ctx, cssElem).then(function(elem) {
                return new webdriver.ActionSequence(ctx.driver)
                    .mouseMove(elem)
                    .perform();
            });
        });
    };

    action.dragAndDrop = function(cssDrag, cssDrop, x, y) {
        return action(function(ctx) {
            ctx.log('Dragging ' + cssDrag + ' and dropping on ' + cssDrop);
            return awaitElement(ctx, cssDrag).then(function(elemDrag) {
                return awaitElement(ctx, cssDrop).then(function(elemDrop) {
                    return new webdriver.ActionSequence(ctx.driver)
                        .mouseDown(elemDrag)
                        .mouseMove(elemDrop, { x: x, y: y })
                        .mouseUp()
                        .perform();
                });
            });
        });
    };

    function predicate(b) {
        return typeof b === 'function' ? b : function(ctx, a) {
            if (typeof a === 'string' && typeof b === 'string') {
                ctx.log("Comparing strings " + JSON.stringify(a) + " and " + JSON.stringify(b));
                return normaliseString(a) == normaliseString(b);
            }
            return a == b;
        };
    }

    predicate.contains = function(b) {
        return function(ctx, a) {
            if (typeof a === 'string' && typeof b === 'string') {
                ctx.log("Looking in " + JSON.stringify(a) + " for " + JSON.stringify(b));
                return normaliseString(a).indexOf(normaliseString(b)) != -1;
            }
            return false;
        };
    };

    function extension_Not() {
        var on = this;
        return condition(function(ctx) {
            return on(ctx).then(function(val) {
                ctx.log('Not: returning ' + !val + ' instead of ' + val);
                return !val;
            });
        });
    }

    function extension_And(other) {
        var on = this;
        return condition(function(ctx) {
            return on(ctx).then(function(val1) {
                return val1 && other(ctx);
            });
        });
    }

    function extension_Or(other) {
        var on = this;
        return condition(function(ctx) {
            return on(ctx).then(function(val1) {
                return val1 || other(ctx);
            });
        });
    }

    function condition(on) {
        var ext = wrapCheckShouldQuit(on);
        ext.not = extension_Not;
        ext.and = extension_And;
        ext.or = extension_Or;
        return ext;
    }

    condition.exists = function(cssElem) {
        return condition(function(ctx) {
            return ctx.driver.isElementPresent(webdriver.By.css(cssElem)).then(function(r) {
                if (!r) {
                    ctx.log('Does not exist: ' + cssElem);
                } else {
                    ctx.log('Exists: ' + cssElem);
                }
                return r;
            });
        });
    };

    condition.locationEndsWith = function(endsWith) {
        return condition(function(ctx) {
            return ctx.driver.getCurrentUrl().then(function(url) {
                var r = url.endsWith(endsWith) || url.endsWith(endsWith + '/');
                if (!r) {
                    ctx.log('Location should end with ' + endsWith + ' but is ' + url);
                }
                return r;
            });
        });
    };

    condition.withFrame = function(cssFrame, test) {
        return condition(function(ctx) {
            return action.withFrame(cssFrame, test)(ctx);
        });
    };

    condition.countIs = function(cssElem, expected) {
        return condition(function(ctx) {
            return ctx.driver.findElements(webdriver.By.css(cssElem)).then(function(actual) {
                var r = expected === actual.length;
                if (!r) {
                    ctx.log('Count of ' + cssElem + ' should be ' + expected +
                        ' but is ' + actual.length);
                }
                return r;
            });
        });
    };

    condition.evaluatesTo = function(js, pred) {
        pred = predicate(pred);
        return condition(function(ctx) {
            return ctx.driver.executeScript("return " + js).then(function(actual) {
                return pred(ctx, actual);
            });
        });
    };

    condition.propertyIs = function(css, prop, pred) {
        return condition.evaluatesTo("window.$ && $(" + JSON.stringify(css) + ")." + prop + "()", pred);
    };

    condition.valueIs = function(css, pred) {
        return condition.propertyIs(css, "val", pred);
    };

    condition.isChecked = function(css) {
        return condition(function(ctx) {
            return awaitElement(ctx, css).then(function(elem) {
                return elem.isSelected();
            });
        });
    };

    condition.isDisabled = function(css) {
        return condition(function(ctx) {
            return awaitElement(ctx, css).then(function(elem) {
                return elem.isEnabled().then(function(en) {
                    return !en;
                });
            });
        });
    };

    condition.textIs = function(css, pred) {
        pred = predicate(pred);
        return condition(function(ctx) {
            return awaitElement(ctx, css).then(function(elem) {
                return elem.getText().then(function (text) {
                    return pred(ctx, text);
                });
            });
        });
    };

    condition.htmlIs = function(css, pred) {
        pred = predicate(pred);
        return condition(function(ctx) {
            return awaitElement(ctx, css).then(function(elem) {
                return elem.getInnerHtml().then(function (html) {
                    return pred(ctx, html);
                });
            });
        });
    };

    var step = function(description, action, postCondition) {
        return {
            description: function() {
                return description;
            },
            execute: function(ctx) {
                return retry(ctx, function(attemptNumber) {
                    ctx.log('Pre-condition attempt ' + attemptNumber);
                    return postCondition(ctx).then(function(result) {
                        if (result) {
                            throw new Error("Post-condition already true!");
                        }
                    });
                }).then(function() {
                    return retry(ctx, function(attemptNumber) {
                        ctx.log('Action attempt ' + attemptNumber);
                        return action(ctx).thenFinally(function(x) {
                            if (x instanceof ShouldQuitError) {
                                throw x;
                            }
                            return retry(ctx, function(attemptNumber) {
                                ctx.log('Post-condition ' + attemptNumber);
                                return postCondition(ctx).then(function(result) {
                                    if (!result) {
                                        throw new Error("Post-condition is false!");
                                    }
                                });
                            });
                        });
                    });
                });
            }
        };
    };

    step.inputText = function(inputCss, value) {
        return step("Input text: " + inputCss + " <= " + value,
            action.inputText(inputCss, value),
            condition.valueIs(inputCss, value)
        );
    };

    step.setProperty = function(elemCss, prop, val) {
        return step("Setting " + prop + " property of " + elemCss + " to " + val,
            action.setProperty(elemCss, prop, val),
            condition.propertyIs(elemCss, prop, val)
        );
    };

    step.setValue = function(elemCss, val) {
        return step.setProperty(elemCss, "val", val);
    };

    var sequence = function(description, steps) {
        return {
            description: function() {
                return description;
            },
            nestedSteps: function() {
                return steps;
            }
        };
    };

    var unconditional = function(description, perform) {
        return {
            execute: function(ctx) {
                return perform(ctx);
            },
            description: function() {
                return description;
            }
        };
    };

    var conditional = function(condition, step) {
        return {
            execute: function(ctx) {
                return retry(ctx, function(attemptNumber) {
                    ctx.log('Evaluating condition for conditional step, attempt: ' + attemptNumber);
                    return condition(ctx);
                }).then(function() {
                    return step.execute(ctx);
                });
            },
            description: function() {
                return step.description();
            }
        };
    };

    return {
        action: action,
        condition: condition,
        predicate: predicate,
        step: step,
        sequence: sequence,
        unconditional: unconditional,
        conditional: conditional,
        element: awaitElement,
        flow: {
            until: until,
            retry: retry,
            forEach: forEach
        }
    };
})();
