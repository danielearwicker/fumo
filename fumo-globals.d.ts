// http://stackoverflow.com/questions/22196846/in-typescript-can-i-declare-that-the-current-scope-contains-all-the-members-of-a
declare var flow: Fumo.FlowApi;
declare var step: Fumo.StepApi;
declare var condition: Fumo.ConditionApi;
declare var predicate: Fumo.PredicateApi;
declare var action: Fumo.ActionApi;
declare function setting(name: string, defaultValue?: string): string;
declare function sequence(description: string, ...steps: Fumo.Step[]): Fumo.ContainerStep;
declare function sequence(description: string, steps: Fumo.Step[]): Fumo.ContainerStep;
declare function unconditional(description: string, action: Fumo.Action): Fumo.ExecutableStep;
declare function conditional(condition: Fumo.Condition, step: Fumo.ExecutableStep): Fumo.ExecutableStep;
declare function check(description: string, condition: Fumo.Condition): Fumo.ExecutableStep;
declare function screenshot(name: string): Fumo.ExecutableStep;
declare function element(css: string): Fumo.TypedWebDriverPromise < any>;
declare function element(path: Fumo.ElementPathSegment[]): Fumo.TypedWebDriverPromise < any>;
declare function loadText(filePath: string): string;
