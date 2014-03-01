var webdriver = require('selenium-webdriver');
var path = require('path');
var fs = require('fs');

var viewModel = {
    steps: ko.observableArray(),
    running: ko.observable(-1),
    testFile: ko.observable(''),
    selectedTestFile: ko.observable('')
};

ko.computed(function() {
    if (viewModel.selectedTestFile()) {
        viewModel.testFile(viewModel.selectedTestFile());
        viewModel.selectedTestFile('');
    }
});

var addStep = function(step, depth, id) {

    var index = viewModel.steps().length;

    var stepModel = {
        description: step.description(),
        id: id || 'Root',
        depth: depth,
        status: ko.observable(''),
        running: ko.computed(function() {
            return viewModel.running() === index;
        })
    };

    if (step.nestedSteps) {

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

var driver;

var runningStep = function() {
    return viewModel.steps()[viewModel.running()];
};

var runOneStep = function() {
    while (runningStep() &&
        (!runningStep().execute || !runningStep().isEnabled())) {
        viewModel.running(viewModel.running() + 1);
    }

    if (!runningStep()) {
        viewModel.running(-1);
        driver.quit();
        driver = null;

    } else {

        runningStep().status('Started');

        runningStep().execute({
            driver: driver,
            log: function(str) {
                runningStep().status(str);
            }
        }).then(function() {

            runningStep().status('Succeeded');
            runningStep().isEnabled(false);
            viewModel.running(viewModel.running() + 1);
            runOneStep();

        }, function(err) {

            runningStep().status(err.toString());
            viewModel.running(-1);
        });
    }
};

viewModel.start = function() {
    if (viewModel.running() !== -1) {
        return;
    }

    viewModel.running(0);

    if (!driver) {
        driver = new webdriver.Builder().withCapabilities(
            webdriver.Capabilities.chrome()).build();
    }
    runOneStep();
};

viewModel.stop = function() {

};

ko.computed(function() {
    if (!viewModel.testFile()) {
        return;
    }

    var rootDir = path.dirname(viewModel.testFile());

    var testModules = {}, requireStack = {};

    var testRequire = function(name) {
        if (!path.extname(name)) {
            name + '.js';
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
            'exports', 'module', 'require',
            source + '\nreturn module;')(exports, module, testRequire)).exports;

        requireStack[name] = false;
        testModules[name] = result;
        return result;
    };

    var testRoot = testRequire(path.basename(viewModel.testFile()));
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

/*

driver.findElement(webdriver.By.name('q')).sendKeys('webdriver');
driver.findElement(webdriver.By.name('btnG')).click();
driver.wait(function() {
    status('waiting...');
    return driver.getTitle().then(function(title) {
        return title === 'webdriver - Google Search';
    });
}, 1000);



*/