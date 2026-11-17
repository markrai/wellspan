import { normalizeState } from './model.js';

const canonical = value => value === null ? null : JSON.stringify(normalizeState(value));
const sameBoard = (left, right) => canonical(left) === canonical(right);

function applyOperation(previous, operation) {
  const board = structuredClone(normalizeState(previous));
  if (!operation || typeof operation !== 'object') throw new Error('Missing edit operation');
  switch (operation.type) {
    case 'food.upsert': {
      const food = structuredClone(operation.food);
      const existing = board.foods.findIndex(item => item.id === food.id);
      if (existing === -1) {
        if (operation.expected !== null) throw new Error('Food changed in another tab');
        board.foods.push(food);
      } else {
        if (!operation.expected || JSON.stringify(board.foods[existing]) !== JSON.stringify(operation.expected)) {
          throw new Error('Food changed in another tab. Reopen the editor.');
        }
        board.foods[existing] = food;
      }
      break;
    }
    case 'food.delete': {
      const existing = board.foods.find(item => item.id === operation.id);
      if (!existing || !operation.expected || JSON.stringify(existing) !== JSON.stringify(operation.expected)) {
        throw new Error('Food changed in another tab. Reload the list.');
      }
      board.foods = board.foods.filter(item => item.id !== operation.id);
      for (const meal of Object.keys(board.meals)) board.meals[meal] = board.meals[meal].filter(id => id !== operation.id);
      break;
    }
    case 'meal.add': {
      const ids = board.meals[operation.meal];
      if (!ids || !board.foods.some(food => food.id === operation.id)) throw new Error('Invalid meal or food');
      if (!ids.includes(operation.id)) ids.push(operation.id);
      break;
    }
    case 'meal.remove': {
      const ids = board.meals[operation.meal];
      if (!ids) throw new Error('Invalid meal');
      board.meals[operation.meal] = ids.filter(id => id !== operation.id);
      break;
    }
    case 'meal.move': {
      const ids = board.meals[operation.meal];
      if (!ids || !ids.includes(operation.id) || !ids.includes(operation.targetId)) throw new Error('Invalid meal order');
      const reordered = ids.filter(id => id !== operation.id);
      const target = reordered.indexOf(operation.targetId);
      if (target === -1) return board;
      reordered.splice(target + (operation.after ? 1 : 0), 0, operation.id);
      board.meals[operation.meal] = reordered;
      break;
    }
    case 'board.replace':
      return normalizeState(operation.board);
    default:
      throw new Error('Unknown edit operation');
  }
  return normalizeState(board);
}

function normalizeRemote(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid Vega revision');
  if (value.revision === 0 && value.state !== null) throw new Error('Uninitialized Vega must have null state');
  if (value.revision > 0 && value.state === null) throw new Error('Initialized Vega is missing its state');
  return { revision: value.revision, state: value.state === null ? null : normalizeState(value.state) };
}

function decideSync(workspace, rawRemote) {
  const remote = normalizeRemote(rawRemote);
  if (workspace.conflict) return 'conflict';
  if (!workspace.outbox.length) {
    if (remote.revision < workspace.ack.revision) return 'conflict';
    if (remote.revision === workspace.ack.revision && !sameBoard(remote.state, workspace.ack.state)) return 'conflict';
    return 'adopt';
  }
  if (remote.revision > 0 && sameBoard(remote.state, workspace.projection)) return 'acknowledge';
  if (remote.revision !== workspace.ack.revision || !sameBoard(remote.state, workspace.ack.state)) return 'conflict';
  if (remote.revision === 0) return workspace.bootstrapApproved ? 'bootstrap' : 'needs-approval';
  return 'replace';
}

export { applyOperation, sameBoard, normalizeRemote, decideSync };
