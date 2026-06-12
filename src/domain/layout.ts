import { MindMapNode, Edge, Position } from '../types';

/**
 * 放射状レイアウトアルゴリズムに基づいて、ノードの自動整列座標を計算します。
 * 計算結果は引数で渡された outPositions マップに格納されます。
 */
export function runAutoLayout(
  nodes: readonly MindMapNode[],
  edges: readonly Edge[],
  rootNode: MindMapNode,
  outPositions: Map<string, Position>
): void {
  const getChildren = (nodeId: string) => {
    return nodes.filter((n) => edges.some((e) => e.source === nodeId && e.target === n.id));
  };

  // 各ノードのサブツリーに含まれる全ノード数（重み、最小1）を計算
  const subtreeWeights = new Map<string, number>();
  const calculateWeights = (nodeId: string): number => {
    const nodeChildren = getChildren(nodeId);
    if (nodeChildren.length === 0) {
      subtreeWeights.set(nodeId, 1);
      return 1;
    }
    let weight = 0;
    for (const child of nodeChildren) {
      weight += calculateWeights(child.id);
    }
    subtreeWeights.set(nodeId, weight);
    return weight;
  };

  calculateWeights(rootNode.id);

  // ルートノードを中央に配置
  outPositions.set(rootNode.id, { x: 0, y: 0 });

  const children = getChildren(rootNode.id);
  if (children.length === 0) return;

  const radiusStep = 240; // 階層ごとの距離

  // 再帰的に放射状に子ノードを配置する関数
  const layoutSubtree = (
    nodeId: string,
    parentX: number,
    parentY: number,
    startAngle: number,
    endAngle: number
  ) => {
    const nodeChildren = getChildren(nodeId);
    if (nodeChildren.length === 0) return;

    let childrenWeightSum = 0;
    for (const child of nodeChildren) {
      childrenWeightSum += subtreeWeights.get(child.id) || 1;
    }

    const parentAngleSpan = endAngle - startAngle;
    let currentAngle = startAngle;

    for (const child of nodeChildren) {
      const childWeight = subtreeWeights.get(child.id) || 1;
      const angleSpan = parentAngleSpan * (childWeight / childrenWeightSum);
      
      const angle = currentAngle + angleSpan / 2;
      const dist = 200; // 孫以降の距離はやや短めに

      const childX = parentX + dist * Math.cos(angle);
      const childY = parentY + dist * Math.sin(angle);

      outPositions.set(child.id, { x: childX, y: childY });

      // 親ノードの進行方向 angle を中心とした扇形に子ノードを広げる
      const maxSpan = Math.PI / 1.5; // 最大120度
      const childSpan = Math.min(angleSpan, maxSpan);
      const childStart = angle - childSpan / 2;
      const childEnd = angle + childSpan / 2;

      layoutSubtree(child.id, childX, childY, childStart, childEnd);

      currentAngle += angleSpan;
    }
  };

  // ルートノードの直接の子ノードたちを 360 度に均等（または重みに応じて）配置
  let currentAngle = 0;
  let rootChildrenWeightSum = 0;
  for (const c of children) {
    rootChildrenWeightSum += subtreeWeights.get(c.id) || 1;
  }

  for (const child of children) {
    const childWeight = subtreeWeights.get(child.id) || 1;
    const angleSpan = (2 * Math.PI) * (childWeight / rootChildrenWeightSum);
    const angle = currentAngle + angleSpan / 2;

    const childX = 0 + radiusStep * Math.cos(angle);
    const childY = 0 + radiusStep * Math.sin(angle);

    outPositions.set(child.id, { x: childX, y: childY });

    // 孫ノード以降の配置
    const maxSpan = children.length === 1 ? Math.PI : Math.min(angleSpan, Math.PI / 1.5);
    const childStart = angle - maxSpan / 2;
    const childEnd = angle + maxSpan / 2;

    layoutSubtree(child.id, childX, childY, childStart, childEnd);

    currentAngle += angleSpan;
  }
}
