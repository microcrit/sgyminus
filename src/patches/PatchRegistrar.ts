const PatchContext = {
    match(from: RegExp | string, to?: RegExp | string) {
        let regexp = from;
        return (replacement: ((content: string) => string) | string) => {
            return (source: string) => {
                function escapeRegExp(str: string) {
                    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                }
                if (to) {
                    if (typeof from === 'string' && typeof to === 'string') {
                        regexp = new RegExp(escapeRegExp(from) + '[\\s\\S]*?' + escapeRegExp(to), 'g');
                    } else if (typeof from === 'string' && to instanceof RegExp) {
                        regexp = new RegExp(escapeRegExp(from) + '[\\s\\S]*?' + to.source, to.flags);
                    } else if (from instanceof RegExp && typeof to === 'string') {
                        regexp = new RegExp(from.source + '[\\s\\S]*?' + escapeRegExp(to), from.flags);
                    } else if (from instanceof RegExp && to instanceof RegExp) {
                        regexp = new RegExp(from.source + '[\\s\\S]*?' + to.source, from.flags);
                    }
                }
                return source.replace(regexp, (match) => {
                    if (typeof replacement === 'function') {
                        return replacement(match);
                    }
                    return replacement;
                });
            };
        };
    },
    imitationCrab(source: string) {
        const fauxWindow = new Proxy({}, {
            get(target: any, prop: string) {
                if (!(prop in target)) {
                    target[prop] = undefined;
                }
                return target[prop];
            },
            set(target: any, prop: string, value: any) {
                return Reflect.set(target, prop, value);
            }
        });
        const fauxDocument = new Proxy({}, {
            get(target: any, prop: string) {
                if (!(prop in target)) {
                    target[prop] = undefined;
                }
                return target[prop];
            },
            set(target: any, prop: string, value: any) {
                return Reflect.set(target, prop, value);
            }
        });

        const func = new Function(source);
        try {
            func.apply({ window: fauxWindow.proxy, document: fauxDocument.proxy }, []);
        } catch (e) {
            // Ignore errors from the imitation
        } finally {
            const windowValue = fauxWindow['proxy'];
            const documentValue = fauxDocument['proxy'];
            return { window: windowValue, document: documentValue };
        }
    }
}

interface Patch {
    filename: RegExp;
    patch?: (source: string, patchContext: typeof PatchContext) => string | Promise<string>;
    eval?: (source: string, patchContext: typeof PatchContext) => void | Promise<void>;
}

export class PatchRegistrar {
    private patches: Patch[] = [];

    registerPatch(patch: Patch) {
        this.patches.push(patch);
    }

    async applyPatches(filename: string, source: string): Promise<string> {
        let modifiedSource = source;
        for (const patch of this.patches) {
            if (patch.filename.test(filename)) {
                if (patch.patch) {
                    modifiedSource = await patch.patch(modifiedSource, PatchContext);
                }
                if (patch.eval) {
                    await patch.eval(modifiedSource, PatchContext);
                }
            }
        }
        return modifiedSource;
    }
}

export const patchRegistrar = new PatchRegistrar();