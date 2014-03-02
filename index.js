var gui = require('nw.gui');
var webdriver = require('selenium-webdriver');
var path = require('path');
var fs = require('fs');

var viewModel = {
    testFile: ko.observable(''),
    selectedTestFile: ko.observable(''),
    steps: ko.observableArray(),
    selectedStep: ko.observable(null)
};

ko.computed(function() {
    if (viewModel.selectedTestFile()) {
        viewModel.testFile(viewModel.selectedTestFile());
        viewModel.selectedTestFile('');
    }
});

viewModel.reload = function() {
    var path = viewModel.testFile();
    viewModel.testFile(null);
    viewModel.testFile(path);
};

viewModel.canReload = ko.computed(function() {
    return viewModel.testFile();
});

viewModel.enableAll = function() {
    var root = viewModel.steps()[0];
    if (root) {
        root.isEnabled(true);
    }
};

viewModel.canEnableAll = ko.computed(function() {
    var root = viewModel.steps()[0];
    return root && root.enabledState() !== 1;
});

viewModel.disableAll = function() {
    var root = viewModel.steps()[0];
    if (root) {
        root.isEnabled(false);
    }
};

viewModel.canDisableAll = ko.computed(function() {
    var root = viewModel.steps()[0];
    return root && root.enabledState() !== -1;
});

viewModel.first = function() {
    viewModel.steps().some(function(step) {
        if (step === viewModel.selectedStep()) {
            return true;
        }
        if (step.execute) {
            step.isEnabled(false);
        }
    });
};

viewModel.last = function() {
    var after = false;
    viewModel.steps().forEach(function(step) {
        if (step === viewModel.selectedStep()) {
            after = true;
        } else if (after && step.execute) {
            step.isEnabled(false);
        }
    });
};

var addStep = function(step, depth, id) {

    var stepModel = {
        description: step.description(),
        id: id || 'Root',
        depth: depth,
        showingLogs: ko.observable(false),
        logs: ko.observableArray(),
        status: ko.observable(''),
        image: ko.observable('unknown')
    };

    stepModel.select = function() {
        viewModel.selectedStep(stepModel);
        return true;
    };

    stepModel.running = ko.computed(function() {
        return stepModel.image() === 'running';
    });

    var element;
    stepModel.initElement = function(initElement) {
        element = initElement;
    };

    stepModel.log = function(msg) {
        stepModel.status(msg);
        stepModel.logs.push(msg);
        element.scrollIntoView(false);
    };

    if (step.nestedSteps) {
        stepModel.image('container');

        var children = ko.observableArray();

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

        viewModel.steps.push(stepModel);

        step.nestedSteps().forEach(function(nestedStep, n) {
            n++;
            children.push(addStep(nestedStep, depth + 1, id ? (id + '.' + n) : '' + n));
        });

    } else {
        stepModel.isEnabled = ko.observable(true);
        stepModel.enabledState = ko.computed(function() {
            return stepModel.isEnabled() ? 1 : -1;
        });
        stepModel.execute = step.execute;
        viewModel.steps.push(stepModel);
    }

    return stepModel;
};

var driver = ko.observable(null),
    runningContext = ko.observable(null);

var firstEnabledStep = ko.computed(function() {
    var first;
    viewModel.steps().some(function(s) {
        if (s.execute && s.isEnabled()) {
            first = s;
            return true;
        }
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

        runningContext({
            driver: driver(),
            log: function(str) {
                rs.log(str);
            }
        });

        var execution;
        try {
            execution = rs.execute(runningContext());
        } catch (x) {
            execution = webdriver.promise.rejected(x);
        }

        execution.then(function() {
            rs.log('Succeeded');
            rs.image('pass');
            rs.showingLogs(false);
            rs.isEnabled(false);
            runOneStep();

        }, function(err) {
            rs.log(err.toString());
            printStackTrace({ e: err }).forEach(function(frame) {
                rs.log('- ' + frame);
            });
            rs.image('fail');
            runningContext(null);
        });
    }
};

viewModel.canStart = ko.computed(function() {
    return firstEnabledStep() && !runningContext();
});

viewModel.start = function() {
    if (runningContext()) {
        return;
    }

    if (!driver()) {
        driver(
            new webdriver.Builder().withCapabilities(
                    webdriver.Capabilities.chrome()).build()
        );
    }
    runOneStep();
};

viewModel.canStop = ko.computed(function() {
    return runningContext();
});

viewModel.stop = function() {
    if (runningContext()) {
        runningContext().shouldQuit = true;
        runningContext().log('Asked step to quit');
    }
};

viewModel.canReset = ko.computed(function() {
    return !runningContext() && driver();
});

viewModel.reset = function() {
    if (driver()) {
        driver().quit();
        driver(null);
    }
};

ko.computed(function() {
    if (!viewModel.testFile()) {
        return;
    }

    var rootDir = path.dirname(viewModel.testFile());

    var testLoad = function(name) {
        return fs.readFileSync(path.join(rootDir, name), 'utf8');
    };

    var testModules = {}, requireStack = {};

    var testRequire = function(name) {
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
            'exports', 'module', 'require, Load',
            source + '\nreturn module;')(exports, module, testRequire, testLoad)).exports;

        requireStack[name] = false;
        testModules[name] = result;
        return result;
    };

    var testRoot;
    try {
        testRoot = testRequire(path.basename(viewModel.testFile()));
    } catch (x) {
        alert(x.toString() + '\n\n' + printStackTrace({ e: x }).join('\n\n'));
        return;
    }

    if (!testRoot || !testRoot.RootStep) {
        alert('Test script did not export RootStep');
        return;
    }

    viewModel.steps.removeAll();
    addStep(testRoot.RootStep, 0);
});

window.onload = function() {
    ko.applyBindings(viewModel);
};

var win = gui.Window.get();
win.on('close', function() {
    var self = this;
    var forceClose = function() {
        self.close(true);
    };
    if (driver()) {
        driver().quit().then(forceClose, forceClose);
    } else {
        forceClose();
    }
});
