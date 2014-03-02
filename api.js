
function ShouldQuitError() {
    this.message = "Stopped by user";
}

ShouldQuitError.prototype = new Error();

function checkShouldQuit(on) {
    return function(ctx) {
        if (ctx.shouldQuit) {
            return webdriver.promise.rejected(new ShouldQuitError());
        }
        return on(ctx);
    }
}

var extension_Delayed = function() {
    var on = this;
    return extend_Action(function(ctx) {
        ctx.log("Waiting a second");
        return webdriver.promise.delayed(1000).then(function() {
            return on(ctx);
        });
    });
};

var extension_Then = function(next) {
    var on = this;
    return extend_Action(function(ctx) {
        return on(ctx).then(function() {
            return next(ctx);
        });
    });
};

var extend_Action = function(on) {
    var ext = checkShouldQuit(on);
    ext.Delayed = extension_Delayed;
    ext.Then = extension_Then;
    return ext;
};

function normaliseString(str) {
    return str.toLowerCase().trim().replace(/\r/g, '');
}

var Perform = {
    Extend: extend_Action,

    Until: function(promisedTruthy) {
        var d = webdriver.promise.defer();
        var attempt = function() {
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
        };
        attempt();
        return d;
    },

    Retry: function(promisedOperation) {
        var d = webdriver.promise.defer();
        var tries = 0;
        var attempt = function() {
            promisedOperation().then(function(result) {
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
        };
        attempt();
        return d;
    },

    ForEach: function(arr, act) {
        var d = webdriver.promise.defer(), i = 0, results = [];
        var step = function() {
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
        };
        step();
        return d;
    },

    AwaitElement: function(ctx, path) {

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

        return Perform.Retry(function() {

            var found = ctx.driver;

            return Perform.ForEach(path, function(part) {
                if (ctx.shouldQuit) {
                    return webdriver.promise.rejected(new ShouldQuitError());
                }
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
    },

    Click: function(cssElem) {
        return extend_Action(function(ctx) {
            ctx.log('Clicking ' + cssElem);
            return Perform.AwaitElement(ctx, cssElem).then(function(elem) {
                return elem.click();
            });
        });
    },

    InputText: function(cssElem, text, extraKeys) {
        return extend_Action(function(ctx) {
            ctx.log('Entering text "' + text + '" into ' + cssElem);
            return Perform.AwaitElement(ctx, cssElem).then(function(elem) {
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
    },

    SendKeys: function(keyArray) {
        if (!Array.isArray(keyArray)) {
            keyArray = [keyArray];
        }
        return extend_Action(function(ctx) {
            return Perform.ForEach(keyArray, function(key) {
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
    },

    Navigate: function(url) {
        return extend_Action(function(ctx) {
            ctx.log('Navigating to ' + url);
            return ctx.driver.get(url);
        });
    },

    WithFrame: function(frameCss, on) {
        return extend_Action(function(ctx) {
            ctx.log("Switching to frame " + frameCss);
            return Perform.AwaitElement(ctx, frameCss).then(function(frameElem) {
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
    },

    Execute: function(js) {
        return extend_Action(function(ctx) {
            ctx.log('Executing: ' + js);
            return ctx.driver.executeScript(js);
        });
    },

    SetProperty: function(css, prop, val) {
        return Perform.Execute("$('" + css + "')." + prop + "(" + JSON.stringify(val) + ")");
    },

    MoveTo: function(cssElem) {
        return extend_Action(function(ctx) {
            ctx.log('Moving mouse to: ' + cssElem);
            return Perform.AwaitElement(ctx, cssElem).then(function(elem) {
                return new webdriver.ActionSequence(ctx.driver)
                    .mouseMove(elem)
                    .perform();
            });
        });
    },

    DragAndDrop: function(cssDrag, cssDrop, x, y) {
        return extend_Action(function(ctx) {
            ctx.log('Dragging ' + cssDrag + ' and dropping on ' + cssDrop);
            return Perform.AwaitElement(ctx, cssDrag).then(function(elemDrag) {
                return Perform.AwaitElement(ctx, cssDrop).then(function(elemDrop) {
                    return new webdriver.ActionSequence(ctx.driver)
                        .mouseDown(elemDrag)
                        .mouseMove(elemDrop, { x: x, y: y })
                        .mouseUp()
                        .perform();
                });
            });
        });
    }
};

var extension_Not = function() {
    var on = this;
    return extend_Confirm(function(ctx) {
        return on(ctx).then(function(val) {
            return !val;
        });
    });
};

var extension_And = function(other) {
    var on = this;
    return extend_Confirm(function(ctx) {
        return on(ctx).then(function(val1) {
            return val1 && other(ctx);
        });
    });
};

var extension_Or = function(other) {
    var on = this;
    return extend_Confirm(function(ctx) {
        return on(ctx).then(function(val1) {
            return val1 || other(ctx);
        });
    });
};

var extend_Confirm = function(on) {
    var ext = checkShouldQuit(on);
    ext.Not = extension_Not;
    ext.And = extension_And;
    ext.Or = extension_Or;
    return ext;
};

var Confirm = {
    Extend: extend_Confirm,

    Exists: function(cssElem) {
        return extend_Confirm(function(ctx) {
            return ctx.driver.isElementPresent(webdriver.By.css(cssElem)).then(function(r) {
                if (!r) {
                    ctx.log('Does not exist: ' + cssElem);
                }
                return r;
            });
        });
    },

    LocationEndsWith: function(endsWith) {
        return extend_Confirm(function(ctx) {
            return ctx.driver.getCurrentUrl().then(function(url) {
                var r = url.endsWith(endsWith) || url.endsWith(endsWith + '/');
                if (!r) {
                    ctx.log('Location should end with ' + endsWith + ' but is ' + url);
                }
                return r;
            });
        });
    },

    WithFrame: function(cssFrame, test) {
        return extend_Confirm(function(ctx) {
            return Perform.WithFrame(cssFrame, test)(ctx);
        });
    },

    CountIs: function(cssElem, expected) {
        return extend_Confirm(function(ctx) {
            return ctx.driver.findElements(webdriver.By.css(cssElem)).then(function(actual) {
                var r = expected === actual.length;
                if (!r) {
                    ctx.log('Count of ' + cssElem + ' should be ' + expected +
                            ' but is ' + actual.length);
                }
                return r;
            });
        });
    },

    Same: function(b) {
        return function(ctx, a) {
            if (typeof a === 'string' && typeof b === 'string') {
                ctx.log("Comparing strings " + JSON.stringify(a) + " and " + JSON.stringify(b));
                return normaliseString(a) == normaliseString(b);
            }
            return a == b;
        };
    },

    Contains: function(b) {
        return function(ctx, a) {
            if (typeof a === 'string' && typeof b === 'string') {
                ctx.log("Looking in " + JSON.stringify(a) + " for " + JSON.stringify(b));
                return normaliseString(a).indexOf(normaliseString(b)) != -1;
            }
            return false;
        };
    },

    EvaluatesTo: function(js, predicate) {
        if (typeof predicate !== 'function') {
            throw new Error('predicate is not a function');
        }
        return extend_Confirm(function(ctx) {
            return ctx.driver.executeScript("return " + js).then(function(actual) {
                return predicate(ctx, actual);
            });
        });
    },

    PropertyIs: function(css, prop, predicate) {
        return Confirm.EvaluatesTo("window.$ && $(" + JSON.stringify(css) + ")." + prop + "()", predicate);
    },

    ValueIs: function(css, predicate) {
        return Confirm.PropertyIs(css, "val", predicate);
    },

    IsChecked: function(css) {
        return extend_Confirm(function(ctx) {
            return Perform.AwaitElement(ctx, css).then(function(elem) {
                return elem.isSelected();
            });
        });
    },

    IsDisabled: function(css) {
        return extend_Confirm(function(ctx) {
            return Perform.AwaitElement(ctx, css).then(function(elem) {
                return elem.isEnabled().then(function(en) {
                    return !en;
                });
            });
        });
    },

    TextIs: function(css, predicate) {
        return extend_Confirm(function(ctx) {
            return Perform.AwaitElement(ctx, css).then(function(elem) {
                return elem.getText().then(function (text) {
                    return predicate(ctx, text);
                });
            });
        });
    },

    HtmlIs: function(css, predicate) {
        return extend_Confirm(function(ctx) {
            return Perform.AwaitElement(ctx, css).then(function(elem) {
                return elem.getInnerHtml().then(function (html) {
                    return predicate(ctx, html);
                });
            });
        });
    }
};

var WebDriverStep = function(description, action, postCondition) {
    return {
        description: function() {
            return description;
        },
        execute: function(ctx) {
            return Perform.Retry(function() {
                return postCondition(ctx).then(function(result) {
                    if (result) {
                        throw new Error("Post-condition already true!");
                    }
                });
            }).then(function() {
                return Perform.Retry(function() {
                    return action(ctx).then(function() {
                        return Perform.Retry(function() {
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

var Sequence = function(description, steps) {
    return {
        description: function() {
            return description;
        },
        nestedSteps: function() {
            return steps;
        }
    };
};

var Steps = {

    InputText: function(inputCss, value) {
        return new WebDriverStep("Input text: " + inputCss + " <= " + value,
            Perform.InputText(inputCss, value),
            Confirm.ValueIs(inputCss, Confirm.Same(value))
        );
    },

    SetProperty: function(elemCss, prop, val) {
        return new WebDriverStep("Setting " + prop + " property of " + elemCss + " to " + val,
            Perform.SetProperty(elemCss, prop, val),
            Confirm.PropertyIs(elemCss, prop, Confirm.Same(val))
        );
    },

    SetValue: function(elemCss, val) {
        return Steps.SetProperty(elemCss, "val", val);
    }
};

var ExecuteOnlyStep = function(description, perform) {
    return {
        execute: function(ctx) {
            return perform(ctx);
        },
        description: function() {
            return description;
        }
    };
};

var ConditionalWebDriverStep = function(condition, step) {
    return {
        execute: function(ctx) {
            return Perform.Until(function() {
                return condition(ctx);
            }).then(function(result) {
                return !result || step.execute(ctx);
            });
        },
        description: function() {
            return step.description();
        }
    };
};
