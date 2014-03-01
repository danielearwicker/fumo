
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
    on.Delayed = extension_Delayed;
    on.Then = extension_Then;
    return on;
};

var Perform = {
    Extend: extend_Action,

    Retry: function(promisedOperation) {
        var d = webdriver.promise.defer();
        var tries = 0;
        var attempt = function() {
            promisedOperation().then(function(result) {
                d.fulfill(result);
            }, function(failed) {
                if (tries++ > 10) {
                    d.reject(failed);
                } else {
                    setTimeout(attempt, 500);
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

    AwaitElement: function(ctx, cssElem) {
        return Perform.Retry(function() {
            return ctx.driver.isElementPresent(webdriver.By.css(cssElem)).then(function(present) {
                if (!present) {
                    throw new Error('Could not find: ' + cssElem);
                }
                return ctx.driver.findElement(webdriver.By.css(cssElem));
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

    InputText: function(cssElem, text) {
        return extend_Action(function(ctx) {
            ctx.log('Entering text "' + text + '" into ' + cssElem);
            return Perform.AwaitElement(ctx, cssElem).then(function(elem) {
                return elem.sendKeys(text);
            });
        });
    },

    SendKeys: function(cssElem, keyArray) {
        return extend_Action(function(ctx) {
            return Perform.ForEach(keyArray, function(key) {
                return Perform.InputText(cssElem, key)(ctx);
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
            return Perform.AwaitElement(ctx, cssElem).then(function(elem) {
                return new webdriver.ActionSequence(ctx.driver)
                    .mouseMove(elem)
                    .perform();
            });
        });
    },

    DragAndDrop: function(cssDrag, cssDrop, x, y) {
        return extend_Action(function(ctx) {
            return Perform.AwaitElement(ctx, cssDrag).then(function(elemDrag) {
                return Perform.AwaitElement(ctx, cssDrop).then(function(elemDrop) {
                    return new webdriver.ActionSequence(ctx.driver)
                        .mouseDown(elemDrag)
                        .mouseMove(elemDrop, x, y)
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
    on.Not = extension_Not;
    on.And = extension_And;
    on.Or = extension_Or;
    return on;
};

var Confirm = {
    Extend: extend_Confirm,

    Exists: function(cssElem) {
        return extend_Confirm(function(ctx) {
            var r = ctx.driver.isElementPresent(webdriver.By.css(cssElem));
            if (!r) {
                ctx.log('Does not exist: ' + cssElem);
            }
            return r;
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
                var r = expected === actual;
                if (!r) {
                    ctx.log('Count of ' + cssElem + ' should be ' + expected + ' but is ' + actual);
                }
                return r;
            });
        });
    },

    Same: function(b) {
        return function(ctx, a) {
            if (typeof a === 'string' && typeof b === 'string') {
                ctx.log("Comparing strings " + JSON.stringify(a) + " and " + JSON.stringify(b));
                return a.toLowerCase().trim() == b.toLowerCase().trim();
            }
            return a == b;
        };
    },

    Contains: function(b) {
        if (typeof a === 'string' && typeof b === 'string') {
            ctx.log("Looking in " + JSON.stringify(a) + " for " + JSON.stringify(b));
            return a.toLowerCase().indexOf(b.toLowerCase().trim()) != -1;
        }
        return false;
    },

    EvaluatesTo: function(js, predicate) {
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
        return Confirm.EvaluatesTo("document.querySelector(" + JSON.stringify(css) + ").checked", Confirm.Same(true));
    },

    IsDisabled: function(css) {
        return Confirm.EvaluatesTo("document.querySelector(" + JSON.stringify(css) + ").disabled", Confirm.Same(true));
    },

    IsParentNodeDisabled: function(css) {
        return Confirm.EvaluatesTo("document.querySelector(" + JSON.stringify(css) +
            ").parentNode.disabled", Confirm.Same(true));
    },

    TextIs: function(css, predicate) {
        return Confirm.PropertyIs(css, "text", predicate);
    },

    HtmlIs: function(css, predicate) {
        return Confirm.PropertyIs(css, "html", predicate);
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
                    return action(ctx);
                });
            }).then(function() {
                return Perform.Retry(function() {
                    return postCondition(ctx).then(function(result) {
                        if (!result) {
                            throw new Error("Post-condition is false!");
                        }
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

