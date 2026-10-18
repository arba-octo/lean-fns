import { updateIn } from 'lean-fns';

const next = updateIn({ user: { name: 'Anna' } }, ['user', 'name'], name => name.toUpperCase());
const name: string = next.user.name;
void name;
// @ts-expect-error The ESM export preserves the declared leaf type.
updateIn({ user: { name: 'Anna' } }, ['user', 'name'], 1);
