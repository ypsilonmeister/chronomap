import { MindMapNode, Edge, Position } from '../types';
import { getChildren, findRootNode, isRootNode } from './graph';

/**
 * 新しく追加する子ノードの初期座標を計算します。
 * 親ノードの左右いずれか空いている側に、かつ他の子ノードと重ならないようにオフセットを適用します。
 */
export function calculateChildNodePosition(
  parentNodeId: string,
  nodes: readonly MindMapNode[],
  edges: readonly Edge[]
): Position | null {
  const parentNode = nodes.find((n) => n.id === parentNodeId);
  if (!parentNode) return null;

  const isParentRoot = isRootNode(parentNodeId, edges);
  const children = getChildren(parentNodeId, nodes, edges);

  let side = 1; // 1 = right, -1 = left
  if (isParentRoot) {
    // 親がルートの場合、左右の既存の子ノード数を比較して少ない方に配置する
    const rightChildrenCount = children.filter((c) => c.position.x > parentNode.position.x).length;
    const leftChildrenCount = children.filter((c) => c.position.x < parentNode.position.x).length;
    if (rightChildrenCount > leftChildrenCount) {
      side = -1;
    } else {
      side = 1;
    }
  } else {
    // 親がルート以外の場合、親と同じ側に配置する
    const rootNode = findRootNode(nodes, edges);
    if (rootNode && parentNode.position.x < rootNode.position.x) {
      side = -1;
    } else {
      side = 1;
    }
  }

  const newX = parentNode.position.x + side * 240;

  // Y座標の決定: 選択した側の既存の子ノードのY座標リストを取得し、重ならないスロットを探索する
  const targetChildren = children.filter((c) =>
    side === 1 ? c.position.x > parentNode.position.x : c.position.x < parentNode.position.x
  );
  const existingYCoords = targetChildren.map((c) => c.position.y);

  let slot = 0;
  let targetY = parentNode.position.y;
  while (true) {
    let offsetY = 0;
    if (slot > 0) {
      const isOdd = slot % 2 !== 0;
      const step = Math.ceil(slot / 2);
      offsetY = isOdd ? 80 * step : -80 * step;
    }
    targetY = parentNode.position.y + offsetY;
    const hasOverlap = existingYCoords.some((y) => Math.abs(y - targetY) < 40);
    if (!hasOverlap) {
      break;
    }
    slot++;
  }

  return { x: newX, y: targetY };
}

/**
 * 新しく追加する兄弟ノードの初期座標を計算します。
 * 対象のノードからY軸方向に80px下方に配置します。
 */
export function calculateSiblingNodePosition(
  nodeId: string,
  nodes: readonly MindMapNode[]
): Position | null {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  return {
    x: node.position.x,
    y: node.position.y + 80,
  };
}
