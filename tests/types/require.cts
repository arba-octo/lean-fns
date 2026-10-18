import library = require('lean-fns');

const next = library.updateIn({ count: 1 }, ['count'], count => count + 1);
const count: number = next.count;
void count;
// @ts-expect-error The CommonJS export preserves the declared leaf type.
library.updateIn({ count: 1 }, ['count'], 'wrong');
