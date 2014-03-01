
exports.RootStep = new Sequence('Fiddle with google', [

    new WebDriverStep('Open google',
        Perform.Navigate('http://www.google.com'),
        Confirm.Exists('#lga')
    ),
    new WebDriverStep('Searching for something',
        Perform.InputText('#gbqfq', "something" + webdriver.Key.ENTER),
        Confirm.Exists('#resultStats')
    ),
    new WebDriverStep('Go to images',
        Perform.Click('#hdtb_msb .hdtb_mitem:nth-child(2) a'),
        Confirm.Exists('.rg_bb_i')

    )
]);
