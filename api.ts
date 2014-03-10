import webdriver = require('selenium-webdriver');
import fs = require("fs");
import path = require("path");

export class ShouldQuitError implements Error {
    message = "Stopped by user";
    name = "ShouldQuitError";
}

ShouldQuitError.prototype = new Error();

export function makeFumoApi(
    setting: (name: string, defaultValue?: string) => string,
    loadText: (filePath: string) => string
): Fumo.Api {

    function stringEndsWith(str: string, searchString: string) {
        return str.length >= searchString.length &&
            str.lastIndexOf(searchString) === (str.length - searchString.length);
    }

    function wrapCheckShouldQuit(on: (ctx: Fumo.ExecutionContext) => any) {
        return function(ctx: Fumo.ExecutionContext) {
            if (ctx.shouldQuit) {
                return webdriver.promise.rejected(new ShouldQuitError());
            }
            return on(ctx);
        };
    }

    function normaliseString(str: string) {
        return str.toLowerCase().trim().replace(/\r/g, '');
    }

    function asPromise(ctx : Fumo.ExecutionContext, create: () => any): webdriver.promise.Promise {
        if (ctx.shouldQuit) {
            return webdriver.promise.rejected(new ShouldQuitError());
        }
        try {
            return webdriver.promise.when(create());
        } catch (x) {
            return webdriver.promise.rejected(x);
        }
    }

    function until<TResult>(
        ctx: Fumo.ExecutionContext,
        truthy: () => Fumo.TypedWebDriverPromise<TResult>
    ) {
        var d = webdriver.promise.defer();
        var attempt = function () {
            asPromise(ctx, truthy).then(function(result) {
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
        return <any>d;
    }

    function retry<TResult>(
        ctx: Fumo.ExecutionContext,
        promisedOperation: (attempt: number) => Fumo.TypedWebDriverPromise<TResult>
    ) {
        var d = webdriver.promise.defer();
        var tries = 0;
        var attempt = function() {
            asPromise(ctx, () => promisedOperation(tries + 1)).then(function (result) {
                d.fulfill(result);
            }, function(x) {
                if (x instanceof ShouldQuitError) {
                    d.reject(x);
                } else if (tries++ > 10) {
                    d.reject(x);
                } else {
                    ctx.log(x.toString());
                    setTimeout(attempt, 500);
                }
            });
        };
        attempt();
        return <any>d;
    }

    function forEach<TInput, TResult>(
        ctx: Fumo.ExecutionContext,
        inputs: TInput[],
        each: (item: TInput) => Fumo.TypedWebDriverPromise<TResult>
    ) {
        var d = webdriver.promise.defer(), i = 0, results: TResult[] = [];
        var step = function() {
            if (i >= inputs.length) {
                d.fulfill(results);
            } else {
                var n = i++;
                asPromise(ctx, () => each(inputs[n])).then(function(result) {
                    results[n] = result;
                    step();
                }, function(err) {
                    d.reject(err);
                });
            }
        };
        step();
        return <any>d;
    }

    function makeByPath(byPath: Fumo.ElementPathSegment[]) {
        if (!Array.isArray(byPath)) {
            byPath = [byPath];
        }

        return byPath.map(function(part) {
            var result: any;
            if (typeof part === 'string') {
                result = webdriver.By.css(<string>part);
            }
            if (part.css) {
                result = webdriver.By.css(part.css);
            }
            if (part.xpath) {
                result = webdriver.By.xpath((part.xpath));
            }
            return result;
        });
    }

    function resolveByPath(ctx: Fumo.ExecutionContext, byPath: Fumo.ElementPathSegment[]) {
        var found: webdriver.WebElementContainer = ctx.driver;
        return forEach(ctx, makeByPath(byPath), function(part) {
            if (!found) {
                return null;
            }
            return <any>found.isElementPresent(part).then(function(present: boolean) {
                if (!present) {
                    found = null;
                    return null;
                }
                return found.findElement(part).then(function(elem: webdriver.WebElement) {
                    found = elem;
                });
            });
        }).then(function() {
            return found;
        });
    }

    function awaitElement(ctx: Fumo.ExecutionContext, byPath: any) : Fumo.TypedWebDriverPromise<webdriver.WebElement> {
        ctx.log('Finding ' + JSON.stringify(byPath));
        return retry(ctx, function() {
            return resolveByPath(ctx, byPath).then(function(result: webdriver.WebElement) {
                if (!result) {
                    ctx.log('Not found: ' + JSON.stringify(byPath));
                    throw new Error('Could not find: ' + JSON.stringify(byPath));
                }
                return result;
            });
        });
    }

    function extension_Delayed(): Fumo.Action {
        var on = <Fumo.Action>this;
        return action(function(ctx: Fumo.ExecutionContext) {
            ctx.log("Waiting a second");
            return <any>webdriver.promise.delayed(1000).then(function() {
                return on(ctx);
            });
        });
    }

    function extension_Then(next: Fumo.Action): Fumo.Action {
        var on = <Fumo.Action>this;
        return action(function(ctx: Fumo.ExecutionContext) {
            return on(ctx).then(function() {
                return next(ctx);
            });
        });
    }

    var action = <Fumo.ActionApi>function action(on) {
        var ext = <Fumo.Action>wrapCheckShouldQuit(on);
        ext.delayed = extension_Delayed;
        ext.then = extension_Then;
        return ext;
    }

    action.click = function(cssElem: any) {
        return action(function(ctx) {
            ctx.log('Clicking ' + JSON.stringify(cssElem));
            return <any>awaitElement(ctx, cssElem).then(function(elem: webdriver.WebElement) {
                return elem.click();
            });
        });
    };

    action.inputText = function(cssElem: any, text: string, extraKeys?: boolean) {
        return action(function(ctx) {
            ctx.log('Entering text "' + text + '" into ' + JSON.stringify(cssElem));
            return <any>awaitElement(ctx, cssElem).then(function(elem: webdriver.WebElement) {
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

    action.sendKeys = function(keyArray: any) {
        if (!Array.isArray(keyArray)) {
            keyArray = [keyArray];
        }
        return action(function(ctx) {
            return forEach(ctx, keyArray, function(key: string) {
                ctx.log('Pressing key "' + key + '"');
                var keyStr = (<any>webdriver.Key)[key.toUpperCase()];
                if (keyStr === void 0) {
                    throw new Error('SendKeys: Invalid key name: ' + key);
                }
                return <any> new webdriver.ActionSequence(ctx.driver)
                    .sendKeys(keyStr)
                    .perform();
            });
        });
    };

    action.navigate = function(url: string, fullScreen: boolean) {
        return action(function(ctx) {
            ctx.log('Navigating to ' + url);
            var chain = ctx.driver.get(url);
            if (fullScreen) {
                chain = chain.then(function() {
                    return ctx.driver.manage().window().maximize();
                });
            }
            return <any>chain;
        });
    };

    action.withFrame = function(frameCss: any, on: Fumo.Action) {
        return action(function(ctx) {
            ctx.log("Switching to frame " + frameCss);
            return <any>awaitElement(ctx, frameCss).then(function(frameElem: webdriver.WebElement) {
                // frameElement is not a number or a string!
                return ctx.driver.switchTo().frame(<any>frameElem).then(function() {
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

    action.execute = function(js: string) {
        return action(function(ctx) {
            ctx.log('Executing: ' + js);
            return <any>ctx.driver.executeScript(js);
        });
    };

    action.setProperty = function(css: string, prop: string, val: any) {
        return action.execute("document.querySelector('" + css + "')." +
            prop + " = " + JSON.stringify(val));
    };

    function move(as: webdriver.ActionSequence, elem: webdriver.WebElement, location?: { x: number; y: number }) {
        return location ? as.mouseMove(elem, location) : as.mouseMove(elem);
    }

    action.moveTo = function (cssElem: any, location?: { x: number; y: number }) {
        return action(function(ctx) {
            ctx.log('Moving mouse to: ' + cssElem);
            return <any>awaitElement(ctx, cssElem).then(function (elem: webdriver.WebElement) {
                return move(new webdriver.ActionSequence(ctx.driver), elem, location).perform();
            });
        });
    };

    action.contextClick = function (cssElem: any, location?: { x: number; y: number; }) {
        return action(function (ctx) {
            ctx.log('Context-clicking ' + cssElem);
            return <any>awaitElement(ctx, cssElem).then(function (elem: webdriver.WebElement) {
                return move(new webdriver.ActionSequence(ctx.driver), elem, location)
                    .click(webdriver.Button.RIGHT)
                    .perform();                
            });
        });
    };

    action.dragAndDrop = function(cssDrag: any, cssDrop: any, x: number, y: number) {
        return action(function(ctx) {
            ctx.log('Dragging ' + cssDrag + ' and dropping on ' + (cssDrop));
            return <any>awaitElement(ctx, cssDrag).then(function(elemDrag: webdriver.WebElement) {
                return awaitElement(ctx, cssDrop).then(function(elemDrop: webdriver.WebElement) {
                    return new webdriver.ActionSequence(ctx.driver)
                        .mouseDown(elemDrag)
                        .mouseMove(elemDrop, { x: x, y: y })
                        .mouseUp()
                        .perform();
                });
            });
        });
    };

    var predicate = <Fumo.PredicateApi>function(b) {
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
        var on = <Fumo.Condition>this;
        return condition(function(ctx) {
            return on(ctx).then(function(val) {
                ctx.log('Not: returning ' + !val + ' instead of ' + val);
                return !val;
            });
        });
    }

    function extension_And(other: Fumo.Condition) {
        var on = <Fumo.Condition>this;
        return condition(function(ctx: Fumo.ExecutionContext) {
            return on(ctx).then(function(val1: boolean):any {
                if (!val1) {
                    ctx.log('And: first is false, so returning false');
                    return val1;
                }
                ctx.log('And: first is true, so evaluating second');
                return other(ctx).then(function(val2: boolean) {
                    if (!val2) {
                        ctx.log('And: second is false, so returning false');
                    } else {
                        ctx.log('And: second is true, so returning true');
                    }
                    return val2;
                });
            });
        });
    }

    function extension_Or(other: Fumo.Condition) {
        var on = <Fumo.Condition>this;
        return condition(function(ctx: Fumo.ExecutionContext) {
            return on(ctx).then(function(val1) {
                return val1 || other(ctx);
            });
        });
    }

    var condition = <Fumo.ConditionApi>function (on) {
        var ext = <Fumo.Condition>wrapCheckShouldQuit(on);
        ext.not = extension_Not;
        ext.and = extension_And;
        ext.or = extension_Or;
        return ext;
    }

    condition.exists = function(byPath: any) {
        return condition(function(ctx) {
            return resolveByPath(ctx, byPath).then(function(r: boolean) {
                if (!r) {
                    ctx.log('Does not exist: ' + JSON.stringify(byPath));
                } else {
                    ctx.log('Exists: ' + JSON.stringify(byPath));
                }
                return !!r;
            });
        });
    };

    condition.locationEndsWith = function(endsWith) {
        return condition(function(ctx) {
            return <any>ctx.driver.getCurrentUrl().then(function(url: string) {
                var r = stringEndsWith(url, endsWith) || stringEndsWith(url, endsWith + '/');
                if (!r) {
                    ctx.log('Location should end with ' + endsWith + ' but is ' + url);
                }
                return r;
            });
        });
    };

    condition.withFrame = function(cssFrame: any, test: Fumo.Condition) {
        return condition(function(ctx) {
            return <any>action.withFrame(cssFrame, <any>test)(ctx);
        });
    };

    condition.countIs = function(cssElem, expected) {
        return condition(function(ctx) {
            return <any>ctx.driver.findElements(webdriver.By.css(cssElem)).then(function(actual: webdriver.WebElement[]) {
                var r = expected === actual.length;
                if (!r) {
                    ctx.log('Count of ' + cssElem + ' should be ' + expected +
                        ' but is ' + actual.length);
                }
                return r;
            });
        });
    };

    condition.evaluatesTo = function(js: string, pred: Fumo.Predicate) {
        pred = predicate(pred);
        return condition(function(ctx) {
            ctx.log('Evaluating: ' + js);
            return <any>ctx.driver.executeScript("return " + js).then(function(actual: any) {
                return pred(ctx, actual);
            });
        });
    };

    condition.propertyIs = function(css: string, prop: string, pred: Fumo.Predicate) {
        return condition.evaluatesTo("document.querySelector(" +
            JSON.stringify(css) + ")." + prop, pred);
    };

    condition.valueIs = function(css: string, pred: Fumo.Predicate) {
        return condition.propertyIs(css, "value", pred);
    };

    condition.isChecked = function(css: any, expected?: boolean) {
        if (expected !== false) {
            expected = true;
        }
        return condition(function(ctx) {
            return <any>awaitElement(ctx, css).then(function(elem: webdriver.WebElement) {
                return elem.isSelected().then(function(v: boolean) {
                    return v == expected;
                });
            });
        });
    };

    condition.isEnabled = function(css: any, expected?: boolean) {
        if (expected !== false) {
            expected = true;
        }
        return condition(function(ctx) {
            return <any>awaitElement(ctx, css).then(function(elem: webdriver.WebElement) {
                return elem.isEnabled().then(function(v: boolean) {
                    return v == expected;
                });
            });
        });
    };

    condition.textIs = function(css: any, pred: Fumo.Predicate) {
        pred = predicate(pred);
        return condition(function(ctx) {
            return <any>awaitElement(ctx, css).then(function(elem: webdriver.WebElement) {
                return elem.getText().then(function (text: string) {
                    return pred(ctx, text);
                });
            });
        });
    };

    condition.htmlIs = function(css: any, pred: Fumo.Predicate) {
        pred = predicate(pred);
        return condition(function(ctx) {
            return <any>awaitElement(ctx, css).then(function(elem: webdriver.WebElement) {
                return elem.getInnerHtml().then(function (html: string) {
                    return pred(ctx, html);
                });
            });
        });
    };

    var step = <Fumo.StepApi> function(description: string, action: Fumo.Action, postCondition: Fumo.Condition): Fumo.ExecutableStep {
        return {
            description: function() {
                return description;
            },
            execute: function(ctx: Fumo.ExecutionContext) {
                return <any>retry(ctx, function(attemptNumber) {
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
                                ctx.log('Post-condition attempt ' + attemptNumber);
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
        return step.setProperty(elemCss, "value", val);
    };

    function flattenArray(input: any[], output: any[]) {
        input.forEach(function (item) {
            if (Array.isArray(item)) {
                flattenArray(item, output);
            } else {
                output.push(item);
            }
        });
    }

    var sequence = function (description: string, ...steps: any[]): Fumo.ContainerStep {
        var flattened: Fumo.Step[] = [];
        flattenArray(steps, flattened);

        return {
            description: function() {
                return description;
            },
            nestedSteps: function() {
                return flattened;
            }
        };
    };

    var unconditional = function(description: string, perform: Fumo.Action): Fumo.ExecutableStep {
        return {
            execute: function(ctx) {
                return perform(ctx);
            },
            description: function() {
                return description;
            }
        };
    };

    var conditional = function(condition: Fumo.Condition, step: Fumo.ExecutableStep): Fumo.ExecutableStep {
        return {
            execute: function(ctx) {
                return retry(ctx, function(attemptNumber) {
                    ctx.log('Evaluating condition for conditional step, attempt: ' + attemptNumber);
                    return condition(ctx);
                }).then(function (conditionResult: boolean) {
                    return conditionResult ? <any>step.execute(ctx) : false;
                });
            },
            description: function() {
                return step.description();
            }
        };
    };

    var check = function(description: string, condition: Fumo.Condition) : Fumo.ExecutableStep {
        return {
            description: function() {
                return description;
            },
            execute: function(ctx) {
                return retry(ctx, function(attemptNumber) {
                    ctx.log('Condition attempt ' + attemptNumber);
                    return condition(ctx).then(function(result) {
                        if (!result) {
                            throw new Error("Condition is false!");
                        }
                    });
                });
            }
        };
    };

    function ensureDirectoryExists(pathStr: string) {
        try {
            var s = fs.statSync(pathStr);
            if (s) {
                if (s.isDirectory()) {
                    return;
                }
                throw new Error(pathStr + " exists but is not a directory");
            }
        } catch (x) {}

        var parentDir = path.dirname(pathStr);
        if (parentDir && parentDir !== pathStr) {
            ensureDirectoryExists(parentDir);
        }
        fs.mkdirSync(pathStr);
    }

    var screenshot = function (saveToPath: string): Fumo.ExecutableStep {
        return {
            description: function () {
                return "Screenshot: " + saveToPath;
            },
            icon: 'screenshot',
            execute: function (ctx) {
                ctx.log('Taking screenshot');
                return <any>ctx.driver.takeScreenshot().then(function (base64Png) {
                    ensureDirectoryExists(path.dirname(saveToPath));
                    fs.writeFileSync(saveToPath, new Buffer(base64Png, "base64"));
                });
            }
        };
    };

    return {
        setting: setting,
        action: action,
        condition: condition,
        predicate: predicate,
        step: step,
        check: check,
        sequence: sequence,
        unconditional: unconditional,
        conditional: conditional,
        screenshot: screenshot,
        element: awaitElement,
        flow: {
            until: until,
            retry: retry,
            forEach: forEach
        },
        loadText: loadText
    };
};
