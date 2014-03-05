///<reference path='selenium-webdriver.d.ts' />
declare module webdriver {

    interface WebElementContainer {

        findElement(locator: webdriver.Locator, ...var_args: any[]): WebElement;
        findElement(locator: any, ...var_args: any[]): WebElement;

        isElementPresent(locator: webdriver.Locator, ...var_args: any[]): webdriver.promise.Promise;
        isElementPresent(locator: any, ...var_args: any[]): webdriver.promise.Promise;

        findElements(locator: webdriver.Locator, ...var_args: any[]): webdriver.promise.Promise;
        findElements(locator: any, ...var_args: any[]): webdriver.promise.Promise;
    }
}