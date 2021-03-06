import webdriver = require('selenium-webdriver');
import fs = require("fs");
import path = require("path");
import child_process = require("child_process");

export class ShouldQuitError implements Error {
    message = "Stopped by user";
    name = "ShouldQuitError";
}

ShouldQuitError.prototype = new Error();

var packageDir = path.dirname(path.dirname(process.execPath));

export function makeFumoApi(
    setting: (name: string, defaultValue?: string) => string,
    rootDir: string
): Fumo.Api {

    function stringEndsWith(str: string, searchString: string) {
        return str.length >= searchString.length &&
            str.lastIndexOf(searchString) === (str.length - searchString.length);
    }

    function wrapCheckShouldQuit(on: (ctx: Fumo.ExecutionContext) => any) {
        return (ctx: Fumo.ExecutionContext) => {
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
        var attempt = () => asPromise(ctx, truthy).then(result => {
            if (result) {
                d.fulfill(result);
            } else {
                setTimeout(attempt, 500);
            }
        }, x => {
            if (x instanceof ShouldQuitError) {
                d.reject(x);
            }
            setTimeout(attempt, 500);
        });
        attempt();
        return <any>d;
    }

    function retry<TResult>(
        ctx: Fumo.ExecutionContext,
        promisedOperation: (attempt: number) => Fumo.TypedWebDriverPromise<TResult>
    ) {
        var d = webdriver.promise.defer();
        var tries = 0;
        var attempt = () => asPromise(ctx, () => promisedOperation(tries + 1)).then(result => d.fulfill(result), x => {
            if (x instanceof ShouldQuitError) {
                d.reject(x);
            } else if (tries++ > 10) {
                d.reject(x);
            } else {
                ctx.log(x.toString());
                setTimeout(attempt, 500);
            }
        });
        attempt();
        return <any>d;
    }

    function forEach<TInput, TResult>(
        ctx: Fumo.ExecutionContext,
        inputs: TInput[],
        each: (item: TInput) => Fumo.TypedWebDriverPromise<TResult>
    ) {
        var d = webdriver.promise.defer(), i = 0, results: TResult[] = [];
        var one = () => {
            if (i >= inputs.length) {
                d.fulfill(results);
            } else {
                var n = i++;
                asPromise(ctx, () => each(inputs[n])).then(result => {
                    results[n] = result;
                    one();
                }, err => d.reject(err));
            }
        };
        one();
        return <any>d;
    }

    function makeByPath(byPath: Fumo.ElementPathSegment[]) {
        if (!Array.isArray(byPath)) {
            byPath = [byPath];
        }

        return byPath.map((part) => {
            var result: any = undefined;
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
        return forEach(ctx, makeByPath(byPath), part => {
            if (!found) {
                return null;
            }
            return <any>found.isElementPresent(part).then((present: boolean) => {
                if (!present) {
                    found = null;
                    return null;
                }
                return found.findElement(part).then((elem: webdriver.WebElement) => found = elem);
            });
        }).then(() => found);
    }

    function awaitElement(ctx: Fumo.ExecutionContext, byPath: any) : Fumo.TypedWebDriverPromise<webdriver.WebElement> {
        ctx.log('Finding ' + JSON.stringify(byPath));
        return retry(ctx, () => resolveByPath(ctx, byPath).then((result: webdriver.WebElement) => {
            if (!result) {
                ctx.log('Not found: ' + JSON.stringify(byPath));
                throw new Error('Could not find: ' + JSON.stringify(byPath));
            }
            return result;
        }));
    }

    function extensionDelayed(): Fumo.Action {
        var on = <Fumo.Action>this;
        return action((ctx: Fumo.ExecutionContext) => {
            ctx.log("Waiting a second");
            return <any>webdriver.promise.delayed(1000).then(() => on(ctx));
        });
    }

    function extensionThen(next: Fumo.Action): Fumo.Action {
        var on = <Fumo.Action>this;
        return action((ctx: Fumo.ExecutionContext) => on(ctx).then(() => next(ctx)));
    }

    var action = <Fumo.ActionApi>function (on) {
        var ext = <Fumo.Action>wrapCheckShouldQuit(on);
        ext.delayed = extensionDelayed;
        ext.then = extensionThen;
        return ext;
    }

    action.click = (cssElem: any) => action((ctx) => {
        ctx.log('Clicking ' + JSON.stringify(cssElem));
        return <any>awaitElement(ctx, cssElem).then((elem: webdriver.WebElement) => elem.click());
    });
    
    action.inputText = (cssElem: any, text: string, extraKeys?: boolean) => action(ctx => {
        ctx.log('Entering text "' + text + '" into ' + JSON.stringify(cssElem));
        return <any>awaitElement(ctx, cssElem).then((elem: webdriver.WebElement) => {
            var chain = elem.clear().then(() => elem.sendKeys(text));
            return extraKeys === false ? chain : chain
                .then(() => elem.sendKeys(webdriver.Key.HOME))
                .then(() => elem.sendKeys(webdriver.Key.END));
        });
    });

    action.sendKeys = (keyArray: any) => {
        if (!Array.isArray(keyArray)) {
            keyArray = [keyArray];
        }
        return action(ctx => forEach(ctx, keyArray, (key: string) => {
            ctx.log('Pressing key "' + key + '"');

            var keyStr = key.length === 1 ? key : (<any>webdriver.Key)[key.toUpperCase()];
            if (keyStr === void 0) {
                throw new Error('SendKeys: Invalid key name: ' + key);
            }
            return <any> new webdriver.ActionSequence(ctx.driver)
                .sendKeys(keyStr)
                .perform();
        }));
    };

    action.navigate = (url: string, fullScreen: boolean) => action(ctx => {
        ctx.log('Navigating to ' + url);
        var chain = ctx.driver.get(url);
        if (fullScreen) {
            chain = chain.then(() => ctx.driver.manage().window().maximize());
        }
        return <any>chain;
    });

    action.withFrame = (frameCss: any, on: Fumo.Action) => action(ctx => {
        ctx.log("Switching to frame " + frameCss);
        return <any>awaitElement(ctx, frameCss).then((frameElem: webdriver.WebElement) =>
            // frameElement is not a number or a string!
            ctx.driver.switchTo().frame(<any>frameElem).then(() => on(ctx).then(
                result => ctx.driver.switchTo().defaultContent().then(() => result),
                err => ctx.driver.switchTo().defaultContent().then(() => {
                    throw err;
                })
            ))
        );
    });
       
    action.execute = (js: string) => action(ctx => {
        ctx.log('Executing: ' + js);
        return <any>ctx.driver.executeScript(js);
    });

    action.setProperty = (css: string, prop: string, val: any) =>
        action.execute("document.querySelector('" + css + "')." +
            prop + " = " + JSON.stringify(val));

    function move(as: webdriver.ActionSequence, elem: webdriver.WebElement, location?: { x: number; y: number }) {
        return location ? as.mouseMove(elem, location) : as.mouseMove(elem);
    }

    action.moveTo = (cssElem: any, location?: { x: number; y: number }) => action(ctx => {
        ctx.log('Moving mouse to: ' + cssElem);
        return <any>awaitElement(ctx, cssElem).then((elem: webdriver.WebElement) =>
            move(new webdriver.ActionSequence(ctx.driver), elem, location)
            .perform());
    });
    
    action.mouseDown = (right: boolean) => action(ctx => {
        ctx.log('Mouse down');
        return <any>new webdriver.ActionSequence(ctx.driver)
            .mouseDown(right ? webdriver.Button.RIGHT : webdriver.Button.LEFT)
            .perform();
    });

    action.mouseUp = (right: boolean) => action(ctx => {
        ctx.log('Mouse up');
        return <any>new webdriver.ActionSequence(ctx.driver)
            .mouseUp(right ? webdriver.Button.RIGHT : webdriver.Button.LEFT)
            .perform();
    });

    action.doubleClick = (right: boolean) => action(ctx => {
        ctx.log('Double click');
        return <any>new webdriver.ActionSequence(ctx.driver)
            .doubleClick(right ? webdriver.Button.RIGHT : webdriver.Button.LEFT)
            .perform();
    });

    action.contextClick = (cssElem: any, location?: { x: number; y: number; }) => action(ctx => {
        ctx.log('Context-clicking ' + cssElem);
        return <any>awaitElement(ctx, cssElem).then((elem: webdriver.WebElement) =>
            move(new webdriver.ActionSequence(ctx.driver), elem, location)
            .click(webdriver.Button.RIGHT)
            .perform());
    });
    
    action.dragAndDrop = (cssDrag: any, cssDrop: any, x: number, y: number) => action(ctx => {
        ctx.log('Dragging ' + cssDrag + ' and dropping on ' + (cssDrop));
        return <any>awaitElement(ctx, cssDrag)
            .then((elemDrag: webdriver.WebElement) => awaitElement(ctx, cssDrop)
            .then((elemDrop: webdriver.WebElement) => new webdriver.ActionSequence(ctx.driver)
            .mouseDown(elemDrag)
            .mouseMove(elemDrop, { x: x, y: y })
            .mouseUp()
            .perform()));
    });

    var predicate = <Fumo.PredicateApi>function(b) {
        return typeof b === 'function' ? b : (ctx, a) => {
            if (typeof a === 'string' && typeof b === 'string') {
                ctx.log("Comparing strings " + JSON.stringify(a) + " and " + JSON.stringify(b));
                return normaliseString(a) == normaliseString(b);
            }
            return a == b;
        };
    }

    predicate.contains = b => (ctx, a) => {
        if (typeof a === 'string' && typeof b === 'string') {
            ctx.log("Looking in " + JSON.stringify(a) + " for " + JSON.stringify(b));
            return normaliseString(a).indexOf(normaliseString(b)) != -1;
        }
        return false;

    };

    function extensionNot() {
        var on = <Fumo.Condition>this;
        return condition(ctx => on(ctx).then(val => {
                ctx.log('Not: returning ' + !val + ' instead of ' + val);
                return !val;
            }));
    }

    function extensionAnd(other: Fumo.Condition) {
        var on = <Fumo.Condition>this;
        return condition((ctx: Fumo.ExecutionContext) =>
            on(ctx).then((val1: boolean): any => {
                if (!val1) {
                    ctx.log('And: first is false, so returning false');
                    return val1;
                }
                ctx.log('And: first is true, so evaluating second');
                return other(ctx).then((val2: boolean) => {
                    if (!val2) {
                        ctx.log('And: second is false, so returning false');
                    } else {
                        ctx.log('And: second is true, so returning true');
                    }
                    return val2;
                });
            }));
    }

    function extensionOr(other: Fumo.Condition) {
        var on = <Fumo.Condition>this;
        return condition((ctx: Fumo.ExecutionContext) => on(ctx).then(val1 => val1 || other(ctx)));
    }

    var condition = <Fumo.ConditionApi>function (on) {
        var ext = <Fumo.Condition>wrapCheckShouldQuit(on);
        ext.not = extensionNot;
        ext.and = extensionAnd;
        ext.or = extensionOr;
        return ext;
    }

    condition.exists = (byPath: any) => condition(ctx => resolveByPath(ctx, byPath)
        .then((r: boolean) => {
            if (!r) {
                ctx.log('Does not exist: ' + JSON.stringify(byPath));
            } else {
                ctx.log('Exists: ' + JSON.stringify(byPath));
            }
            return !!r;
        }));
        

    condition.locationEndsWith = (endsWith) => condition(ctx =>
        <any>ctx.driver.getCurrentUrl().then((url: string) => {
            var r = stringEndsWith(url, endsWith) || stringEndsWith(url, endsWith + '/');
            if (!r) {
                ctx.log('Location should end with ' + endsWith + ' but is ' + url);
            }
            return r;
        }));

    condition.withFrame = (cssFrame: any, test: Fumo.Condition) => 
        condition(ctx => <any>action.withFrame(cssFrame, <any>test)(ctx));

    condition.countIs = (cssElem, expected) => condition(ctx => <any>ctx.driver.findElements(webdriver.By.css(cssElem))
        .then((actual: webdriver.WebElement[]) => {
        var r = expected === actual.length;
        if (!r) {
            ctx.log('Count of ' + cssElem + ' should be ' + expected +
                ' but is ' + actual.length);
        }
        return r;
    }));
    

    condition.evaluatesTo = (js: string, pred: Fumo.Predicate) => {
        pred = predicate(pred);
        return condition(ctx => {
            ctx.log('Evaluating: ' + js);
            return <any>ctx.driver.executeScript("return " + js).then((actual: any) => pred(ctx, actual));
        });
    };

    condition.propertyIs = (css: string, prop: string, pred: Fumo.Predicate) =>
        condition.evaluatesTo("document.querySelector(" +
            JSON.stringify(css) + ")." + prop, pred);

    condition.valueIs = (css: string, pred: Fumo.Predicate) =>
        condition.propertyIs(css, "value", pred);
    
    condition.isChecked = (css: any, expected?: boolean) => {
        if (expected !== false) {
            expected = true;
        }
        return condition(ctx => <any>awaitElement(ctx, css)
            .then((elem: webdriver.WebElement) => elem.isSelected()
            .then((v: boolean) => v == expected)));
    };

    condition.isEnabled = (css: any, expected?: boolean) => {
        if (expected !== false) {
            expected = true;
        }
        return condition(ctx => <any>awaitElement(ctx, css)
            .then((elem: webdriver.WebElement) => elem.isEnabled()
            .then((v: boolean) => v == expected)));
    };

    condition.textIs = (css: any, pred: Fumo.Predicate) => {
        pred = predicate(pred);
        return condition(ctx => <any>awaitElement(ctx, css)
            .then((elem: webdriver.WebElement) => elem.getText()
            .then((text: string) => pred(ctx, text))));
    };

    condition.htmlIs = (css: any, pred: Fumo.Predicate) => {
        pred = predicate(pred);
        return condition(ctx => <any>awaitElement(ctx, css)
            .then((elem: webdriver.WebElement) => elem.getInnerHtml()
            .then((html: string) => pred(ctx, html))));
    };

    condition.compareImage = (css: string, filePaths: string[], expectedIndex: number) => {
        return condition(ctx => {
            return <any>awaitElement(ctx, css).then(imageElement => {
                return imageElement.getAttribute("src").then((srcValue: string) => {

                    var base64 = srcValue.substr(srcValue.indexOf(";base64,") + 8);
                    var imageBuffer = new Buffer(base64, "base64");
                    
                    var d = webdriver.promise.defer();

                    fs.writeFile("__comparingImage", imageBuffer, err => {
                        if (err) {
                            d.reject(err);
                        } else {
                            var results: number[] = [];
                            var loop = () => {
                                if (results.length === filePaths.length) {
                                    var lowestVal: number = null;
                                    var lowestIndex: number = null;
                                    results.forEach((val, i) => {
                                        if (lowestVal === null || val < lowestVal) {
                                            lowestVal = val;
                                            lowestIndex = i;
                                        }
                                    });
                                    if (expectedIndex === lowestIndex) {
                                        d.fulfill(true);
                                    } else {
                                        ctx.log("Image compare expected " + expectedIndex + ", closest was " + lowestIndex);
                                        d.fulfill(false);
                                    }
                                } else {
                                    var compareWithPath = filePaths[results.length];
                                    var args = [
                                        "-metric",
                                        "MAE",
                                        "__comparingImage",
                                        path.join(rootDir, compareWithPath),
                                        "null:"
                                    ];

                                    var comparePath = path.join(packageDir, "compare.exe");

                                    //ctx.log("Launching " + comparePath + " with " + JSON.stringify(args));
                                    try {
                                        child_process.execFile(comparePath, args, {}, (err2, stdout, stderr) => {
                                            if (!stdout) {
                                                stdout = new Buffer("");
                                            }
                                            if (!stderr) {
                                                stderr = new Buffer("");
                                            }
                                            var str = stdout.toString() + "";
                                            var pattern = /\(([^\)]+)\)/;
                                            var match = str.match(pattern);
                                            if (!match) {
                                                str = stderr.toString() + "";
                                                match = str.match(pattern);
                                            }
                                            if (!match) {
                                                d.reject(new Error("Output from compare: [" + stdout.toString() + "], errors: [" + stderr.toString() + "]"));
                                            } else {
                                                var val = parseFloat(match[1]);
                                                ctx.log("Difference with " + compareWithPath + " = " + val);
                                                results.push(val);
                                                loop();
                                            }
                                        });
                                    } catch (e) {
                                        d.reject(new Error("child_process.execFile threw: " + e.toString()));
                                    }
                                }
                            }
                            loop();
                        }
                    });
                    return d;
                });
            });
        });
    };
    
    var step = <Fumo.StepApi> function(description: string, action: Fumo.Action, postCondition: Fumo.Condition): Fumo.ExecutableStep {
        return {
            description: () => description,
            execute: (ctx: Fumo.ExecutionContext) => <any>retry(ctx, attemptNumber => {
                ctx.log('Pre-condition attempt ' + attemptNumber);
                return postCondition(ctx).then(result => {
                    if (result) {
                        throw new Error("Post-condition already true!");
                    }
                });
            }).then(() => retry(ctx, attemptNumber => {
                ctx.log('Action attempt ' + attemptNumber);
                return action(ctx).thenFinally(x => {
                    if (x instanceof ShouldQuitError) {
                        return webdriver.promise.rejected(x);
                    }
                    return retry(ctx, attemptNumber2 => {
                        ctx.log('Post-condition attempt ' + attemptNumber2);
                        return postCondition(ctx).then(result => {
                            if (!result) {
                                throw new Error("Post-condition is false!");
                            }
                        });
                    });
                });
            }))
        };
    };

    step.inputText = (inputCss, value) => 
        step("Input text: " + inputCss + " <= " + value,
            action.inputText(inputCss, value),
            condition.valueIs(inputCss, value)
        );

    step.setProperty = (elemCss, prop, val) =>
        step("Setting " + prop + " property of " + elemCss + " to " + val,
            action.setProperty(elemCss, prop, val),
            condition.propertyIs(elemCss, prop, val)
        );

    step.setValue = (elemCss, val) => step.setProperty(elemCss, "value", val);
    
    function flattenArray(input: any[], output: any[]) {
        input.forEach(item => {
            if (Array.isArray(item)) {
                flattenArray(item, output);
            } else {
                output.push(item);
            }
        });
    }

    var sequence = (description: string, ...steps: any[]): Fumo.ContainerStep => {
        var flattened: Fumo.Step[] = [];
        flattenArray(steps, flattened);
        return {
            description: () => description,
            nestedSteps: () => flattened
        };
    };

    var unconditional = (description: string, perform: Fumo.Action): Fumo.ExecutableStep => {
        return {
            execute: ctx => perform(ctx),
            description: () => description
        };
    };

    var conditional = (cond: Fumo.Condition, st: Fumo.ExecutableStep): Fumo.ExecutableStep => {
        return {
            execute: ctx => retry(ctx, attemptNumber => {
                ctx.log('Evaluating condition for conditional step, attempt: ' + attemptNumber);
                return cond(ctx);
            }).then((conditionResult: boolean) => conditionResult ? <any>st.execute(ctx) : false),
            description: () => st.description()
        };
    };

    var check = (description: string, cond: Fumo.Condition): Fumo.ExecutableStep => {
        return {
            description: () => description,
            execute: ctx => retry(ctx, attemptNumber => {
                ctx.log('Condition attempt ' + attemptNumber);
                return cond(ctx).then(result => {
                    if (!result) {
                        throw new Error("Condition is false!");
                    }
                });
            })
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

    var screenshot = (saveToPath: string): Fumo.ExecutableStep => {
        return {
            description: () => "Screenshot: " + saveToPath,
            icon: 'screenshot',
            execute: ctx => {
                ctx.log('Say cheese...');
                return <any>webdriver.promise.delayed(1000).then(() =>
                    ctx.driver.takeScreenshot().then( base64Png => {
                        ensureDirectoryExists(path.dirname(saveToPath));
                        fs.writeFileSync(saveToPath, new Buffer(base64Png, "base64"));
                    }));
            }
        };
    };

    var note = (js: string, saveToPath: string): Fumo.ExecutableStep => {
        return {
            description: () => "Note: " + saveToPath,
            execute: ctx => {
                ctx.log('Taking notes...');
                return <any>ctx.driver.executeScript("return " + js).then((actual: any) => {
                    if (typeof actual !== 'string') {
                        actual = JSON.stringify(actual);
                    }
                    ensureDirectoryExists(path.dirname(saveToPath));
                    fs.writeFileSync(saveToPath, actual);
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
        note: note,
        element: awaitElement,
        flow: {
            until: until,
            retry: retry,
            forEach: forEach
        },
        loadText: name => fs.readFileSync(path.join(rootDir, name)).toString('utf8')
    };
};
