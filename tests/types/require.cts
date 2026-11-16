import library = require('lean-fns');

const next = library.updateIn({ count: 1 }, ['count'], count => count + 1);
const count: number = next.count;
void count;
// @ts-expect-error The CommonJS export preserves the declared leaf type.
library.updateIn({ count: 1 }, ['count'], 'wrong');

const produced = library.produce({ count: 1 }, draft => { draft.count++; });
const draftType: library.ProduceDraft<Readonly<{ count: number }>> = produced;
draftType.count++;
// @ts-expect-error The CommonJS produce export rejects an async callback.
library.produce({ count: 1 }, async draft => { draft.count++; });
