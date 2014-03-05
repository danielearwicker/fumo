
ko.bindingHandlers.properties = {
    update: function(element, valueAccessor) {
        var obj = ko.unwrap(valueAccessor());
        if (obj) {
            Object.keys(obj).forEach(function(key) {
                element[key] = obj[key];
            });
        }
    }
};

ko.bindingHandlers.initElement = {
    init: function(element, valueAccessor) {
        valueAccessor()(element);
    }
};
