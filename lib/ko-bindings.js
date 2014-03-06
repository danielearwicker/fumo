ko.bindingHandlers.scroll = {
    'init': function (element, valueAccessor) {
        var params = valueAccessor();

        element.addEventListener('scroll', function () {
            if (ko.isObservable(params.left)) {
                params.left(element.scrollLeft);
            }
            if (ko.isObservable(params.top)) {
                params.top(element.scrollTop);
            }
        });

        ko.computed(function () {
            var v;
            if ('left' in params) {
                v = Math.floor(ko.unwrap(params.left));
                if (element.scrollLeft != v) {
                    element.scrollLeft = v;
                }
            }
            if ('top' in params) {
                v = Math.floor(ko.unwrap(params.top));
                if (element.scrollTop != v) {
                    element.scrollTop = v;
                }
            }
        });
    }
};

var simulatedObservable = (function () {

    var timer = null, items = [];

    var check = function () {
        items = items.filter(function (item) {
            return document.contains(item.elem);
        });
        if (items.length === 0) {
            clearInterval(timer);
            timer = null;
            return;
        }
        items.forEach(function (item) {
            item.obs(item.getter());
        });
    };

    return function (elem, getter, obs) {
        if (!ko.isObservable(obs)) {
            obs = ko.observable();
        }
        obs(getter());
        items.push({ obs: obs, getter: getter, elem: elem });
        if (timer === null) {
            timer = setInterval(check, 500);
        }
        return obs;
    };
})();

ko.bindingHandlers.properties = {
    // Support two-way binding if an observable is specified
    init: function (element, valueAccessor) {
        var value = ko.unwrap(valueAccessor()) || {};
        Object.keys(value).forEach(function (propName) {
            var obs = value[propName];
            if (ko.isWriteableObservable(obs)) {
                simulatedObservable(element, function() {
                     return element[propName];
                }, obs);
            }
        });
    },
    update: function (element, valueAccessor) {        
        var obj = ko.unwrap(valueAccessor()) || {};
        if (obj) {
            Object.keys(obj).forEach(function (key) {
                element[key] = ko.unwrap(obj[key]);
            });
        }
    }
};
