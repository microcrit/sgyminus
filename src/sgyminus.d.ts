import type angular from "angular";
import type React from "react";

export interface ScriptContext {
    document: Document;
    window: Window;
    angular: angular.IAngularStatic;
    react: React;
    fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
}

export type ScriptFunction = (context: ScriptContext) => void | Promise<void>;

export interface Script {
    name: string;
    description: string;
    run: ScriptFunction;
}