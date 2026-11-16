import { updateIn, produce, type ProduceDraft } from 'lean-fns';

const next = updateIn({ user: { name: 'Anna' } }, ['user', 'name'], name => name.toUpperCase());
const name: string = next.user.name;
void name;
// @ts-expect-error The ESM export preserves the declared leaf type.
updateIn({ user: { name: 'Anna' } }, ['user', 'name'], 1);

const produced = produce({ user: { name: 'Anna' } }, draft => { draft.user.name = 'Olga'; });
const draftType: ProduceDraft<Readonly<{ name: string }>> = produced.user;
draftType.name = 'Anna';
// @ts-expect-error The ESM produce export checks field types.
produce({ count: 1 }, draft => { draft.count = 'wrong'; });
