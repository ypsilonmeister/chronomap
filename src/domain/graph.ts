import { MindMapNode, Edge } from '../types';

/**
 * 指定したノードがルートノード（親エッジを持たないノード）かどうかを判定します。
 */
export function isRootNode(nodeId: string, edges: readonly Edge[]): boolean {
  return !edges.some((edge) => edge.target === nodeId);
}

/**
 * 指定したノードの直接の子ノードの一覧を取得します。
 */
export function getChildren(nodeId: string, nodes: readonly MindMapNode[], edges: readonly Edge[]): MindMapNode[] {
  return nodes.filter((n) => edges.some((e) => e.source === nodeId && e.target === n.id));
}

/**
 * グラフの中からルートノード（親エッジを持たない最初のノード）を探索します。
 */
export function findRootNode(nodes: readonly MindMapNode[], edges: readonly Edge[]): MindMapNode | null {
  return nodes.find((node) => !edges.some((edge) => edge.target === node.id)) || null;
}

/**
 * 指定したルートノードID配下のサブツリーに含まれる全ノードと全エッジを収集します。
 */
export function collectSubtree(
  rootNodeId: string,
  nodes: readonly MindMapNode[],
  edges: readonly Edge[]
): { nodes: MindMapNode[]; edges: Edge[] } {
  const subtreeNodes: MindMapNode[] = [];
  const subtreeEdges: Edge[] = [];
  const visited = new Set<string>();

  function traverse(id: string) {
    if (visited.has(id)) return;
    visited.add(id);

    const node = nodes.find((n) => n.id === id);
    if (node) {
      subtreeNodes.push(node);
    }

    const childEdges = edges.filter((e) => e.source === id);
    for (const edge of childEdges) {
      subtreeEdges.push(edge);
      traverse(edge.target);
    }
  }

  traverse(rootNodeId);
  return { nodes: subtreeNodes, edges: subtreeEdges };
}
