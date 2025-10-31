import type { Script } from "./sgyminus";
import { patchRegistrar } from "./patches/PatchRegistrar";
import type angular from "angular";
import type React from "react";

let angularThis: angular.IAngularStatic;
let reactThis: typeof React;

Object.defineProperty(window, 'loadReact', {
    get: () => (react: typeof React) => {
        reactThis = react;
    }
});

Object.defineProperty(window, 'loadAngular', {
    get: () => (angular: angular.IAngularStatic) => {
        angularThis = angular;
    },
    configurable: false,
    enumerable: false
});

// Expose Angular to script world via WebPack
patchRegistrar.registerPatch({
    filename: /common-([a-z0-9]+)\.js$/,
    patch(source: string, patchContext) {
        return source.replace(
            /(function\(e, t\) \{\n\s+e\.exports = )([\s\S]*?)(\n\s+\};)/,
            (match, p1, p2, p3) => {
                return `${p1}
    window.loadAngular(${p2})
${p3}`;
            }
        );
    }
})

// Expose React to script world
patchRegistrar.registerPatch({
    filename: /react-common-(-[a-z0-9]+)?\.js$/,
    eval(source: string, patchContext) {
        const data = patchContext.imitationCrab(source);
        if (data.window && data.window.React) {
            Object.getOwnPropertyDescriptor(window, 'loadReact')!.get!.call(window)(data.window.React);
        }
    }
});

function basename(path: string): string {
    return path.split('/').pop() || path;
}

interface ElementQuery {
    tag?: string;
    classes?: string[];
    id?: string;
    attributes?: { [key: string]: string | null };
    descendants?: ElementQuery[];
    children?: ElementQuery[];
    nth?: number;
}

function parseSimpleQuery(query: ElementQuery): string {
    let selector = '';
    if (query.tag) {
        selector += query.tag;
    }
    if (query.id) {
        selector += `#${query.id}`;
    }
    if (query.classes) {
        for (const cls of query.classes) {
            selector += `.${cls}`;
        }
    }
    if (query.attributes) {
        for (const [attr, value] of Object.entries(query.attributes)) {
            if (value === null) {
                selector += `[${attr}]`;
            } else {
                selector += `[${attr}="${value}"]`;
            }
        }
    }
    for (const descendant of query.descendants || []) {
        selector += ` ${parseSimpleQuery(descendant)}`;
    }
    for (const child of query.children || []) {
        selector += ` > ${parseSimpleQuery(child)}`;
    }
    if (query.nth !== undefined) {
        selector += `:nth-child(${query.nth})`;
    }
    return selector;
}

let listeners = new Map<string, (a: MutationRecord[], b: MutationObserver) => void>();
function registerListener(id: string, callback: (a: MutationRecord[], b: MutationObserver) => void) {
    listeners.set(id, callback);
}

const observer = new MutationObserver(async (mutations) => {
    for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const elem = node as HTMLElement;
                if (elem.tagName === 'SCRIPT') {
                    elem.setAttribute('data-src', (elem as HTMLScriptElement).src);
                    elem.removeAttribute('src');
                    const newScript = document.createElement('script');
                    let response = await fetch((elem as HTMLScriptElement).getAttribute('data-src')!);
                    let fetched = await response.text();
                    fetched = await patchRegistrar.applyPatches(basename((elem as HTMLScriptElement).getAttribute('data-src')!), fetched);
                    let blob = new Blob([fetched], { type: 'application/javascript' });
                    let objectURL = URL.createObjectURL(blob);
                    newScript.src = objectURL;
                    newScript.type = (elem as HTMLScriptElement).type;
                    newScript.async = (elem as HTMLScriptElement).async;
                    newScript.defer = (elem as HTMLScriptElement).defer;
                    elem.replaceWith(newScript);
                }
                for (const [id, callback] of listeners) {
                    if (elem.matches(id)) {
                        callback([mutation], observer);
                    }
                }
            }

        }
    }
});

registerListener(parseSimpleQuery({
    tag: 'body',
    descendants: [{
        tag: "nav",
        attributes: { "role": "navigation" },
        descendants: [{
            tag: "ul",
            classes: ["nav"],
            nth: 2
        }]
    }]
}), (mutations, observer) => {
});

function hotReload() {
    const document = window.document;
    const newDoc = document.implementation.createHTMLDocument();
    newDoc.documentElement.innerHTML = document.documentElement.innerHTML;
    for (const script of Array.from(newDoc.scripts)) {
        const newScript = document.createElement('script');
        newScript.src = script.src;
        newScript.type = script.type;
        newScript.async = script.async;
        newScript.defer = script.defer;
        script.replaceWith(newScript);
    }
    document.replaceChild(newDoc.documentElement, document.documentElement);
}

let enabledScripts: Script[] = [];

function randomId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message === "hot-reload") {
        hotReload();
    } else if (message.type === "enabled-scripts") {
        enabledScripts = message.enabledScripts as Script[];
        for (const script of enabledScripts) {
            try {
                script.run({
                    document: window.document,
                    window: window,
                    angular: angularThis!,
                    react: reactThis!,
                    fetch: (input: RequestInfo, init?: RequestInit) => {
                        const id = randomId();
                        chrome.runtime.sendMessage({ type: "fetch", input, init, idme: id });
                        return new Promise<Response>((resolve, reject) => {
                            function handleResponse(message: any) {
                                if (message.type === "fetch-response" && message.idme === id) {
                                    chrome.runtime.onMessage.removeListener(handleResponse);
                                    const blob = new Blob([message.body], { type: 'text/plain' });
                                    const response = new Response(blob, { status: 200, statusText: "OK" });
                                    resolve(response);
                                }
                            }
                            chrome.runtime.onMessage.addListener(handleResponse);
                        });
                    }
                });
            } catch (error) {
                console.error(`Failed to run script ${script.name}:`, error);
            }
        }
    }
});