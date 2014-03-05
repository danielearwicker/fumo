///<reference path='selenium-webdriver.d.ts' />

declare module Fumo {

    interface TypedWebDriverPromiseCallback<TIn, TOut> {
        (val: TIn): TOut;
    }

    interface TypedWebDriverPromise<TResult> {
        then<TNext>(
            successCallback: TypedWebDriverPromiseCallback<TResult, TNext>,
            errorCallback?: TypedWebDriverPromiseCallback<Error, TNext>): TypedWebDriverPromise<TNext>;
        thenFinally<TNext>(eitherCallback: TypedWebDriverPromiseCallback<any, TNext>): TypedWebDriverPromise<TNext>;
    }

    interface Step {
        description(): string;
    }

    interface ContainerStep extends Step {
        nestedSteps(): Step[];
    }

    interface ExecutionContext {
        log(message: string): void;
        driver: any;
        shouldQuit: boolean;
    }

    interface ExecutableStep extends Step {
        execute(ctx: ExecutionContext): TypedWebDriverPromise<void>;
    }

    interface ElementPathSegment {
        css?: string;
        xpath?: string;
    }

    interface Action {
        (ctx: ExecutionContext): TypedWebDriverPromise<void>;
        then(next: Action): Action;
        delayed(): Action;
    }

    interface ActionApi {
        (rawAction: { (ctx: ExecutionContext): TypedWebDriverPromise<void> }): Action

        click(cssElem: string): Action;
        click(elemPath: ElementPathSegment[]): Action;

        inputText(cssElem: string, text: string, extraKeys?: boolean): Action;

        sendKeys(keys: string[]): Action;
        sendKeys(keys: string): Action;

        navigate(url: string, maximize: boolean): Action;

        withFrame(frameCss: string, on: Action): Action;

        execute(js: string): Action;

        setProperty(css: string, prop: string, val: any): Action;

        moveTo(css: string): Action;
        dragAndDrop(cssDrag: string, cssDrop: string, x: number, y: number): Action;
    }

    interface Predicate {
        (ctx: ExecutionContext, value: any): boolean;
    }

    interface PredicateApi {
        (value: any): Predicate;
        contains(value: string): Predicate;
    }

    interface Condition {
        (ctx: ExecutionContext): TypedWebDriverPromise<boolean>;
        and(also: Condition): Condition;
        or(either: Condition): Condition;
        not(): Condition;
    }

    interface ConditionApi {
        (rawCondition: { (ctx: ExecutionContext): TypedWebDriverPromise<boolean> }): Condition;

        exists(elemPath: ElementPathSegment[]): Condition;
        exists(cssElem: string): Condition;

        locationEndsWith(endsWith: string): Condition;
        withFrame(cssFrame: string, condition: Condition): Condition;
        countIs(cssElem: string, expected: number): Condition;

        isChecked(css: string, expected?: boolean): Condition;
        isChecked(elemPath: ElementPathSegment[], expected?: boolean): Condition;

        isEnabled(css: string, expected?: boolean): Condition;
        isEnabled(elemPath: ElementPathSegment[], expected?: boolean): Condition;

        evaluatesTo(js: string, value: any): Condition;
        evaluatesTo(js: string, pred: Predicate): Condition;

        propertyIs(css: string, prop: string, value: any): Condition;
        propertyIs(css: string, prop: string, pred: Predicate): Condition;

        valueIs(css: string, value: any): Condition;
        valueIs(css: string, pred: Predicate): Condition;

        textIs(css: string, value: any): Condition;
        textIs(css: string, pred: Predicate): Condition;

        htmlIs(css: string, value: any): Condition;
        htmlIs(css: string, pred: Predicate): Condition;
    }

    interface StepApi {

        (description: string, action: Action, condition: Condition): ExecutableStep;

        inputText(inputCss: string, value: string): Step;
        setProperty(elemCss: string, prop: string, val: string): Step;
        setValue(elemCss: string, val: string): Step;
    }

    interface FlowApi {
        until<TInput, TResult>(ctx: ExecutionContext, truthy: () => TypedWebDriverPromise<TInput>): TypedWebDriverPromise<TResult>;
        retry<TResult>(ctx: ExecutionContext, attempt: (attempt: number) => TypedWebDriverPromise<TResult>): TypedWebDriverPromise<TResult>;
        forEach<TInput, TResult>(ctx: ExecutionContext, inputs: TInput[], each: (item: TInput) => TypedWebDriverPromise<TResult>): TypedWebDriverPromise<TResult[]>;
    }

    interface Api {
        flow: FlowApi;
        step: StepApi;
        condition: ConditionApi;
        predicate: PredicateApi;
        action: ActionApi;
        setting(name: string, defaultValue?: string): string;
        sequence(description: string, steps: Step[]): ContainerStep;
        unconditional(description: string, action: Action): ExecutableStep;
        conditional(condition: Condition, step: ExecutableStep): ExecutableStep;
        check(description: string, condition: Condition): ExecutableStep;
        element(ctx: ExecutionContext, css: string): TypedWebDriverPromise<webdriver.WebElement>;
        element(ctx: ExecutionContext, path: ElementPathSegment[]): TypedWebDriverPromise<webdriver.WebElement>;
        loadText(filePath: string): string;
    }
}
