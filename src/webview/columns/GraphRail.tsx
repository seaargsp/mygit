import type { LaneCommit } from '../../git/graph';
import { laneColor } from '../lib/format';

export const ROW_HEIGHT = 26;
export const LANE_WIDTH = 14;

type Props = {
  commits: LaneCommit[];
  /** Rows drawn above the first commit; the working-tree row occupies row 0. */
  rowOffset: number;
  headIndex: number;
  width: number;
  height: number;
};

const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

export function GraphRail({ commits, rowOffset, headIndex, width, height }: Props) {
  const rowOf = new Map<string, number>();
  const laneOf = new Map<string, number>();
  commits.forEach((commit, index) => {
    rowOf.set(commit.sha, index + rowOffset);
    laneOf.set(commit.sha, commit.lane);
  });

  const edges: { key: string; d: string; lane: number; dashed?: boolean }[] = [];

  if (rowOffset > 0 && commits.length > 0) {
    const head = commits[headIndex] ?? commits[0];
    edges.push({
      key: 'working-tree',
      lane: head.lane,
      dashed: true,
      d: edgePath(head.lane, rowY(0), head.lane, rowY(rowOf.get(head.sha)!)),
    });
  }

  for (const commit of commits) {
    const row = rowOf.get(commit.sha)!;
    for (const parent of commit.parents) {
      const parentRow = rowOf.get(parent);
      if (parentRow === undefined) {
        // Parent is outside the loaded page: run the rail off the bottom edge.
        edges.push({
          key: `${commit.sha}-${parent}`,
          lane: commit.lane,
          d: `M ${laneX(commit.lane)} ${rowY(row)} V ${height}`,
        });
        continue;
      }
      edges.push({
        key: `${commit.sha}-${parent}`,
        lane: commit.lane,
        d: edgePath(commit.lane, rowY(row), laneOf.get(parent)!, rowY(parentRow)),
      });
    }
  }

  return (
    <svg class="graph__rail" width={width} height={height} aria-hidden="true">
      {edges.map(edge => (
        <path
          key={edge.key}
          d={edge.d}
          fill="none"
          stroke={laneColor(edge.lane)}
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-dasharray={edge.dashed ? '3 3' : undefined}
        />
      ))}
      {rowOffset > 0 && commits.length > 0 && (
        <circle
          cx={laneX((commits[headIndex] ?? commits[0]).lane)}
          cy={rowY(0)}
          r={3.6}
          fill="var(--surface-1)"
          stroke={laneColor((commits[headIndex] ?? commits[0]).lane)}
          stroke-width="1.6"
          stroke-dasharray="2 2"
        />
      )}
      {commits.map((commit, index) => (
        <g key={commit.sha}>
          {index === headIndex && (
            <circle
              cx={laneX(commit.lane)}
              cy={rowY(index + rowOffset)}
              r={6.5}
              fill="none"
              stroke={laneColor(commit.lane)}
              stroke-width="1.2"
              opacity="0.45"
            />
          )}
          <circle
            cx={laneX(commit.lane)}
            cy={rowY(index + rowOffset)}
            r={commit.parents.length > 1 ? 4.6 : 3.8}
            fill={laneColor(commit.lane)}
          />
        </g>
      ))}
    </svg>
  );
}

/** Straight down the lane, then an S-bend into the parent lane over the last row. */
function edgePath(fromLane: number, fromY: number, toLane: number, toY: number): string {
  const x1 = laneX(fromLane);
  const x2 = laneX(toLane);
  if (fromLane === toLane) return `M ${x1} ${fromY} V ${toY}`;
  const bendY = Math.max(fromY, toY - ROW_HEIGHT);
  const midY = (bendY + toY) / 2;
  return `M ${x1} ${fromY} V ${bendY} C ${x1} ${midY} ${x2} ${midY} ${x2} ${toY}`;
}
