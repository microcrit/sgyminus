import type { Script } from "./sgyminus";

function injectWebpageScript(tabId: number) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['webpage.js']
    });
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            injectWebpageScript(tab.id!);
        }
    });
});

function parseSconfig(sconfigContent: string): Script {
    const lines = sconfigContent.split('\n');
    let name = "Unnamed Script";
    let description = "";
    let runFunction: Function | null = null;

    let i = 0;
    for (const line of lines) {
        const [key, ...rest] = line.split('=');
        const value = rest.join('=').trim();
        if (key === 'name') {
            name = value;
            i++;
        } else if (key === 'description') {
            description = value;
            i++;
        } else if (key === 'run') {
            let aggregate: string[] = [value];
            i++;
            while (i < lines.length && !lines[i]!.includes('=')) {
                aggregate.push(lines[i]!);
                i++;
            }
            const extracted = aggregate.join('\n');
            const extractors = [/^\(context\)\s*\(\s*function\s*\(context\)\s*{/, /}\s*\)\s*$/];
            for (const extractor of extractors) {
                if (extractor.test(extracted)) {
                    runFunction = new Function("context", aggregate.join('\n'));
                }
            }
        } else {
            i++;
        }
    }

    if (!runFunction) {
        throw new Error("Failed to parse run function from sconfig.");
    }

    return {
        name,
        description,
        run: runFunction as (context: any) => void | Promise<void>
    };
}

function stringifyScript(script: Script): string {
    return `name=${script.name}
description=${script.description}
run=(context) (
    ${script.run.toString()}
)
`;
}

chrome.runtime.onMessage.addListener((message, sender) => {
    if (message === "get-enabled-scripts") {
        chrome.storage.sync.get("enabledScripts", (data) => {
            const enabledScripts = data.enabledScripts || [];
            let scriptPromises: Promise<Script>[] = [];
            for (const scriptName of enabledScripts) {
                chrome.storage.sync.get(scriptName, (data) => {
                    const sconfigContent = data[scriptName];
                    if (sconfigContent) {
                        try {
                            const script = parseSconfig(sconfigContent);
                            scriptPromises.push(Promise.resolve(script));
                        } catch (error) {
                            console.error(`Failed to parse sconfig for ${scriptName}:`, error);
                        }
                    }
                });
            }
            Promise.all(scriptPromises).then((scripts) => {
                chrome.tabs.query({}, (tabs) => {
                    for (const tab of tabs) {
                        chrome.tabs.sendMessage(tab.id!, { type: "enabled-scripts", enabledScripts: scripts });
                    }
                });
            });
        });
    } else if (message === "script-from-url") {
        const { url } = message;
        fetch(url)
            .then(response => response.text())
            .then(sconfigContent => {
                try {
                    const script = parseSconfig(sconfigContent);
                    chrome.storage.sync.set({ [script.name]: sconfigContent });
                } catch (error) {
                    console.error(`Failed to parse sconfig from ${url}:`, error);
                }
            });
    } else if (message.type === "fetch") {
        const { input, init, idme } = message;
        fetch(input, init)
            .then(response => response.text())
            .then(body => {
                chrome.tabs.sendMessage(sender.tab!.id!, { type: "fetch-response", body, idme });
            });
    }
});

