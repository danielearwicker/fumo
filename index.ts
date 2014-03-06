import webdriver = require('selenium-webdriver');
import path = require('path');
import fs = require('fs');
import api = require('./api');

var driver = ko.observable<webdriver.WebDriver>(null);

var nwGui: any = require('nw.gui');
var appWindow: any = nwGui.Window;
var win = appWindow.get();
win.on('close', function() {
    var self = this;
    var forceClose = () => self.close(true);
    if (driver()) {
        driver().quit().then(forceClose, forceClose);
    } else {
        forceClose();
    }
});

module PersistentSettings {

    function qualify(name: string) {
        return 'testSetting_' + name;
    }

    var accessedNames: { [name: string]: boolean } = {};

    export function clearAccessedNames() {
        accessedNames = {};
    }

    export function wasNameAccessed(name: string) {
        return !!accessedNames[name];
    }

    export function getAccessedNames() {
        return Object.keys(accessedNames);
    }

    export function put(name: string, value: string) {
        name = qualify(name);
        localStorage.setItem(name, value);
    }

    export function clear(name: string) {
        name = qualify(name);
        localStorage.removeItem(name);
    }

    export function get(name: string, defaultValue?: string): string {
        accessedNames[name] = true;
        name = qualify(name);
        var val = localStorage.getItem(name);
        if (val === null) {
            val = defaultValue;
            localStorage.setItem(name, val);
        }
        return val;
    }
}

module viewModel {
    export var testFile = ko.observable('');
    export var selectedTestFile = ko.observable('');
    export var loadErrorMessage = ko.observable('To get started, load a test script.');
    export var steps = ko.observableArray<any>();
    export var stepListScrollTop = ko.observable(0);
    export var stepListClientHeight = ko.observable(0);
    export var selectedStep = ko.observable(null);
    export var settings = ko.observableArray<any>();
    export var interactiveCode = ko.observable('');
    export var interactiveResult = ko.observable('');
    export var interactiveTrying = ko.observable(false);
    export var dirtySettings = ko.observable(false);
    export var searchText = ko.observable('');
    export var searchResults = ko.observableArray<any>();

    var currentSearchResult = 0;

    export function searchNextResult(incr: number) {
        currentSearchResult += incr;
        var r = searchResults();
        if (r.length === 0) {
            return;
        }
        if (currentSearchResult >= r.length) {
            currentSearchResult = 0;
        }
        if (currentSearchResult < 0) {
            currentSearchResult = r.length - 1;
        }
        var step = r[currentSearchResult];
        if (step) {
            setTimeout(function() {
                step.scrollIntoView();
                selectedStep(step);
            }, 0);
        }
    }

    ko.computed(function() {

        var st = searchText();
        steps(); // also update if steps change (reload)

        setTimeout(function() {
            searchResults.removeAll();
            currentSearchResult = 0;

            if (!st) {
                steps().forEach(function(step) {
                    step.isSearchHit(false);
                });
                return;
            }
            st = st.toLowerCase();

            steps().forEach(function(step) {
                if ((step.description.toLowerCase().indexOf(st) != -1) ||
                    (step.id.indexOf(st) === 0)) { // "begins" search for ID
                    searchResults.push(step);
                    step.isSearchHit(true);
                } else {
                    step.isSearchHit(false);
                }
            });

            searchNextResult(0);
        }, 0);

    }).extend({ throttle: 200 });

    ko.computed(function() {
        if (selectedTestFile()) {
            testFile(selectedTestFile());
            selectedTestFile('');
        }
    });

    if (nwGui.App.argv.length > 0) {        
        testFile(nwGui.App.argv);
    } else {
        var previouslyLoaded = localStorage.getItem('previouslyLoadedTest');
        localStorage.setItem('previouslyLoadedTest', ''); // protect from crashing
        if (previouslyLoaded) {
            testFile(previouslyLoaded);
        }
    }

    export function enableAll() {
        var root = steps()[0];
        if (root) {
            root.isEnabled(true);
        }
    }

    export var canEnableAll = ko.computed(function() {
        var root = steps()[0];
        return root && root.enabledState() !== 1;
    });

    export function disableAll() {
        var root = steps()[0];
        if (root) {
            root.isEnabled(false);
        }
    }

    export var canDisableAll = ko.computed(function() {
        var root = steps()[0];
        return root && root.enabledState() !== -1;
    });

    export function first() {
        steps().some(function(step: any) {
            if (step === selectedStep()) {
                return true;
            }
            if ('execute' in step) {
                step.isEnabled(false);
            }
            return false;
        });
    };

    export function last() {
        var after = false;
        steps().forEach(function(step) {
            if (step === selectedStep()) {
                after = true;
            } else if (after && step.execute) {
                step.isEnabled(false);
            }
        });
    };

    export var logClientHeight = ko.observable(0);
    export var logScrollHeight = ko.observable(0);
    export var logScrollTop = ko.observable(0);
        
    export var constantStepHeight = 64;

    export var contextSteps = ko.computed(() => {
        var topStep = steps()[Math.floor(stepListScrollTop() / constantStepHeight)];
        var ctx = [];
        while (topStep && topStep.parent) {
            ctx.unshift(topStep);
            topStep = topStep.parent;
        }
        return ctx;
    });

    export var visibleSteps = ko.computed(function () {        
        var all = steps(), scrollTop = stepListScrollTop();
        var first = Math.floor(scrollTop / constantStepHeight);
        var last = Math.ceil((scrollTop + stepListClientHeight()) / constantStepHeight);
        return { first: first, steps: all.slice(first, last + 1) };        
    }).extend({ throttle: 10 });

    var addStep = function(step: Fumo.Step, parent: any, depth: number, id?: string) {
        if (!step || typeof step.description !== 'function') {
            return;
        }

        var stepModel: any = {
            parent: parent,
            description: step.description(),
            id: id || 'Root',
            depth: depth,
            index: steps.peek().length,
            showingLogs: ko.observable(false),
            logs: ko.observableArray(),
            status: ko.observable(''),
            isSearchHit: ko.observable(false),
            image: ko.observable('unknown')
        };

        stepModel.shortDescription = stepModel.description;
        if (stepModel.shortDescription.length > 40) {
            stepModel.shortDescription = stepModel.shortDescription.substr(0, 19) + "..." +
                stepModel.shortDescription.substr(stepModel.shortDescription.length - 19);
        }

        stepModel.select = function() {
            selectedStep(stepModel);
            stepModel.scrollIntoView();
            return true;
        };

        stepModel.running = ko.computed(function() {
            return stepModel.image() === 'running';
        });
        
        stepModel.hitTest = function (yPos: number): any[] {
            if (yPos >= stepModel.top() && yPos <= stepModel.bottom()) {
                var childHits: any[];
                if (children().some(function (child) {
                    childHits = child.hitTest(yPos);
                    return childHits.length !== 0;
                })) {
                    return [stepModel].concat(childHits);
                }
                return [stepModel]
            }
            return [];
        };

        // Better than browser's version which scrolls unnecessarily
        stepModel.scrollIntoView = function () {            
            var ourTop = stepModel.index * constantStepHeight,
                ourBottom = ourTop + constantStepHeight;

            if (ourBottom > stepListScrollTop() + stepListClientHeight()) {
                stepListScrollTop(ourBottom - stepListClientHeight());
            }
            if (ourTop < stepListScrollTop()) {
                stepListScrollTop(ourTop);
            }
        };

        stepModel.scrollToTop = function () {
            stepListScrollTop(stepModel.index * constantStepHeight);
        };
        
        stepModel.log = function(msg: string) {
            stepModel.status(msg);
            stepModel.logs.push(msg);
            stepModel.select();
            logScrollTop(Math.max(0, logScrollHeight() - logClientHeight()));
        };

        var children = ko.observableArray<any>();

        if ('nestedSteps' in step) {
            stepModel.image('container');

            stepModel.enabledState = ko.computed(function() {

                var c = children();
                if (c.length === 0) {
                    return false;
                }
                var f = c[0].enabledState();
                return c.slice(1).some(function(o) {
                    return o.enabledState() !== f;
                }) ? 0 : f;
            });

            stepModel.isEnabled = ko.computed({
                read: function() {
                    return stepModel.enabledState() != -1;
                },
                write: function(val) {
                    children().forEach(function(c) {
                        c.isEnabled(val);
                    });
                }
            });

            steps.push(stepModel);

            (<Fumo.ContainerStep>step).nestedSteps().forEach(function(nestedStep, n) {
                n++;
                children.push(addStep(nestedStep, stepModel, depth + 1, id ? (id + '.' + n) : '' + n));
            });

        } else {
            stepModel.isEnabled = ko.observable(true);
            stepModel.enabledState = ko.computed(function() {
                return stepModel.isEnabled() ? 1 : -1;
            });
            stepModel.execute = (<Fumo.ExecutableStep>step).execute;
            steps.push(stepModel);
        }
        
        return stepModel;
    };

    var runningContext = ko.observable(null);

    export function reload() {
        var path = testFile();
        testFile(null);
        testFile(path);
    }

    export var canReload = ko.computed(function () {
        return testFile() && !runningContext();
    });

    var firstEnabledStep = ko.computed(function() {
        var first: any;
        steps().some(function(s: any) {
            if (s.execute && s.isEnabled()) {
                first = s;
                return true;
            }
            return false;
        });
        return first;
    });

    var runningStep = function() {
        return firstEnabledStep();
    };

    var runOneStep = function() {
        if (!runningStep()) {
            runningContext(null);

        } else {

            var rs = runningStep();
            rs.log('Started');
            rs.image('running');
            rs.showingLogs(true);

            var rc : Fumo.ExecutionContext = {
                driver: getDriver(),
                log: function(str) {
                    rs.log(str);
                },
                shouldQuit: false
            };
            runningContext(rc);

            var execution: Fumo.TypedWebDriverPromise<void>;
            try {
                execution = rs.execute(rc);
            } catch (x) {
                execution = <any>webdriver.promise.rejected(x);
            }

            execution.then(function() {
                if (rc.shouldQuit) {
                    throw new api.ShouldQuitError();
                }

                rs.log('Succeeded');
                rs.image('pass');
                rs.showingLogs(false);
                rs.isEnabled(false);
                runOneStep();

            }, function(err: Error) {
                rs.log(err.toString());
                printStackTrace({ e: err }).forEach(function(frame) {
                    rs.log('- ' + frame);
                });
                rs.image('fail');
                runningContext(null);
            });
        }
    };

    export var canStart = ko.computed(function() {
        return firstEnabledStep() && !runningContext();
    });

    var getDriver = function() {
        if (!driver()) {
            driver(
                new webdriver.Builder().withCapabilities(
                    webdriver.Capabilities.chrome()).build()
            );
        }
        return driver();
    };

    export function start() {
        if (runningContext()) {
            return;
        }

        runOneStep();
    }

    export var canStop = ko.computed(function() {
        return runningContext();
    });

    export function stop() {
        if (runningContext()) {
            runningContext().shouldQuit = true;
            runningContext().log('Asked step to quit');
        }
    }

    export var canReset = ko.computed(function() {
        return !runningContext() && driver();
    });

    export function reset() {
        if (driver()) {
            driver().quit();
            driver(null);
        }
    }

    var declareApi = function(api: Fumo.Api, paramName: string) {
        return Object.keys(api).map(function(member) {
            return 'var ' + member + ' = ' + paramName + '.' + member + ';\n';
        }).join('');
    };

    ko.computed(function() {
        if (!testFile()) {
            return;
        }

        document.title = 'Fumo - ' + path.basename(testFile());

        var rootDir = path.dirname(testFile());

        var testLoadText = function(name: string): string {
            return fs.readFileSync(path.join(rootDir, name)).toString('utf8');
        };

        var testModules: { [name: string]: any } = {},
            requireStack: { [name: string]: boolean } = {},
            fumoApi = api.makeFumoApi(PersistentSettings.get, testLoadText);

        var testRequire = function(name: string) {
            if (!path.extname(name)) {
                name += '.js';
            }

            name = path.join(rootDir, name);
            var result = testModules[name];
            if (result) {
                return result;
            }

            if (requireStack[name]) {
                throw new Error('Recursive require! ' + Object.keys(requireStack).join(' '));
            }

            var source = fs.readFileSync(name, 'utf8'),
                exports = {},
                module = { exports: exports };

            requireStack[name] = true;

            result = (new Function(
                'exports', 'module', 'require, fumoApi',
                declareApi(fumoApi, 'fumoApi') + source + '\nreturn module;')(
                    exports, module, testRequire, fumoApi)).exports;

            requireStack[name] = false;
            testModules[name] = result;
            return result;
        };

        PersistentSettings.clearAccessedNames();

        var testRoot: Fumo.Step;
        try {
            testRoot = testRequire(path.basename(testFile()));
        } catch (x) {
            interactiveResult(x.toString());
            return;
        }

        if (!testRoot || typeof testRoot.description !== 'function') {
            interactiveResult('Test script did not export root');
            return;
        }

        dirtySettings(false);

        setTimeout(() => {
            // Remove any settings that the test never asked for
            settings().filter(function(settingModel: any) {
                return !PersistentSettings.wasNameAccessed(settingModel.name);
            }).forEach(function(settingModel) {
                settings.remove(settingModel);
            });

            // Add models for the settings not already visible
            PersistentSettings.getAccessedNames().forEach(function(name) {
                if (!settings().some(function(settingModel: any) {
                    return settingModel.name === name;
                })) {
                    var val = ko.observable(PersistentSettings.get(name));
                    var settingModel: any = { name: name, value: val };
                    settingModel.clear = function() {
                        PersistentSettings.clear(name);
                        settings.remove(settingModel);
                        dirtySettings(true);
                    };

                    settings.push(settingModel);
                    val.subscribe(function() {
                        PersistentSettings.put(name, val());
                        dirtySettings(true);
                    });
                }
            });

            settings.sort(function(a, b) {
                return a.name.localeCompare(b.name);
            });
        }, 0);

        interactiveResult('');

        var ctxSteps = contextSteps.peek(),
            top = ctxSteps[ctxSteps.length - 1],
            topId = top && top.id;

        steps.removeAll();
        addStep(testRoot, null, 0);

        if (topId) {
            var sameIdAsTop: any;
            steps().some(function (step) {
                if (topId.indexOf(step.id) === 0) {
                    sameIdAsTop = step;
                }
                return sameIdAsTop && sameIdAsTop.id === topId;
            });
            if (sameIdAsTop) {
                sameIdAsTop.scrollToTop();
            }
        }

        localStorage.setItem('previouslyLoaded', testFile());
    });

    export function interactiveKeyDown(m: any, ev: KeyboardEvent) {
        if (ev.keyCode === 13) {
            interactiveTry();
            return false;
        }
        return true;
    }

    export function interactiveTry() {
        var code = interactiveCode();
        if (!code) {
            return;
        }
        interactiveResult('');
        interactiveTrying(true);

        var log = function(str: string) {
            interactiveResult(str + "\n" + interactiveResult());
        };

        try {
            var fumoApi = api.makeFumoApi(null, null);
            var result: any = (new Function('fumoApi', declareApi(fumoApi, 'fumoApi') + 'return ' + code))(fumoApi);
            if (typeof result === 'function') {
                var prom = result({
                    driver: getDriver(),
                    log: log
                });
                if (!prom) {
                    log('No promise returned');
                    interactiveTrying(false);
                } else {
                    prom.then(function(val: any) {
                        log('Result: ' + val);
                        interactiveTrying(false);
                    }, function(x: Error) {
                        log(x.toString());
                        log('(Did you remember to close the debugger in the target browser?)');
                        interactiveTrying(false);
                    })
                }
            } else {
                log('Was not a valid action or condition function');
                interactiveTrying(false);
            }
        } catch (x) {
            interactiveTrying(false);
            log(x.toString());
        }
    }

    export function debug() {
        win.showDevTools();
    }
}

window.onload = function() {
    ko.applyBindings(viewModel);
};

