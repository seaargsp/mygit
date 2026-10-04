import type { LaneCommit } from '../../git/graph';
import { avatarColor, initials, laneColor } from '../lib/format';

export const ROW_HEIGHT = 28;
export const LANE_WIDTH = 18;
const PAD = 6;

export const laneX = (lane: number) => PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;
const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

export type RailEdge = { key: string; d: string; lane: number; from: number; to: number; dashed: boolean };

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (y1 + y2) / 2;
  return `C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
}

/**
 * Edges for every parent link. An edge leaves its commit, bends into the lane reserved for
 * the parent (immediately, for merge parents), runs down that lane and bends into the
 * parent's own lane on the last row.
 */
export function buildEdges(commits: LaneCommit[], rowOffset: number, totalRows: number): RailEdge[] {
  const rowOf = new Map<string, number>();
  const laneOf = new Map<string, number>();
  commits.forEach((commit, index) => {
    rowOf.set(commit.sha, index + rowOffset);
    laneOf.set(commit.sha, commit.lane);
  });
  const bottom = totalRows * ROW_HEIGHT;
  const edges: RailEdge[] = [];

  for (const commit of commits) {
    const row = rowOf.get(commit.sha)!;
    commit.parents.forEach((parent, index) => {
      const travel = commit.parentLanes[index] ?? commit.lane;
      const parentRow = rowOf.get(parent);
      const parentLane = laneOf.get(parent) ?? travel;
      let d = `M ${laneX(commit.lane)} ${rowY(row)}`;
      let currentRow = row;

      if (travel !== commit.lane) {
        if (parentRow === row + 1) {
          edges.push({ key: `${commit.sha}-${parent}`, d: `${d} ${curve(laneX(commit.lane), rowY(row), laneX(parentLane), rowY(parentRow))}`, lane: travel, from: row, to: parentRow, dashed: Boolean(commit.stash) });
          return;
        }
        d += ` ${curve(laneX(commit.lane), rowY(row), laneX(travel), rowY(row + 1))}`;
        currentRow = row + 1;
      }

      if (parentRow === undefined) {
        // Parent outside the loaded commits: run the lane off the bottom edge.
        d += ` V ${bottom}`;
        edges.push({ key: `${commit.sha}-${parent}`, d, lane: travel, from: row, to: totalRows, dashed: Boolean(commit.stash) });
        return;
      }

      if (parentLane === travel) {
        d += ` V ${rowY(parentRow)}`;
      } else {
        if (parentRow - 1 > currentRow) d += ` V ${rowY(parentRow - 1)}`;
        const startY = parentRow - 1 > currentRow ? rowY(parentRow - 1) : rowY(currentRow);
        d += ` ${curve(laneX(travel), startY, laneX(parentLane), rowY(parentRow))}`;
      }
      edges.push({ key: `${commit.sha}-${parent}`, d, lane: travel, from: row, to: parentRow, dashed: Boolean(commit.stash) });
    });
  }
  return edges;
}

type Props = {
  commits: LaneCommit[];
  edges: RailEdge[];
  rowOffset: number;
  /** Lane of the WIP node, or null when there is no WIP row. */
  wipLane: number | null;
  headRow: number | null;
  width: number;
  height: number;
  start: number;
  end: number;
  isDim: (sha: string) => boolean;
  selected: Set<string>;
  avatars: Record<string, string> | null;
};

export function GraphRail({ commits, edges, rowOffset, wipLane, headRow, width, height, start, end, isDim, selected, avatars }: Props) {
  const visibleEdges = edges.filter(edge => edge.to >= start && edge.from <= end);
  const visible = commits.slice(Math.max(0, start - rowOffset), Math.max(0, end - rowOffset + 1));
  const first = Math.max(0, start - rowOffset);

  return (
    <svg class="graph__rail" width={width} height={height} aria-hidden="true">
      {wipLane !== null && headRow !== null && (
        <path
          d={`M ${laneX(wipLane)} ${rowY(0)} V ${rowY(headRow)}`}
          fill="none"
          stroke={laneColor(wipLane)}
          stroke-width="1.8"
          stroke-dasharray="3 3"
        />
      )}
      {visibleEdges.map(edge => (
        <path
          key={edge.key}
          d={edge.d}
          fill="none"
          stroke={laneColor(edge.lane)}
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-dasharray={edge.dashed ? '3 3' : undefined}
        />
      ))}
      {wipLane !== null && (
        <circle cx={laneX(wipLane)} cy={rowY(0)} r={8} fill="var(--surface-1)" stroke={laneColor(wipLane)} stroke-width="1.8" stroke-dasharray="3 2.5" />
      )}
      {visible.map((commit, index) => {
        const row = first + index + rowOffset;
        const cx = laneX(commit.lane);
        const cy = rowY(row);
        const color = laneColor(commit.lane);
        const dim = isDim(commit.sha);
        const isSelected = selected.has(commit.sha);
        if (commit.stash) {
          return (
            <g key={commit.sha} opacity={dim ? 0.3 : 1}>
              <rect x={cx - 6.5} y={cy - 6.5} width={13} height={13} rx={2} fill="var(--surface-1)" stroke={color} stroke-width="1.8" stroke-dasharray="2.5 2" />
              <path d={`M ${cx - 3} ${cy - 1} h 6 M ${cx - 3} ${cy + 2} h 6`} stroke={color} stroke-width="1.4" />
            </g>
          );
        }
        if (commit.parents.length > 1) {
          return (
            <g key={commit.sha} opacity={dim ? 0.3 : 1}>
              {isSelected && <circle cx={cx} cy={cy} r={8} fill="none" stroke="var(--accent)" stroke-width="1.5" />}
              <circle cx={cx} cy={cy} r={4.5} fill={color} />
            </g>
          );
        }
        const avatar = avatars?.[commit.authorEmail.trim().toLowerCase()];
        return (
          <g key={commit.sha} opacity={dim ? 0.3 : 1}>
            {row === headRow && <circle cx={cx} cy={cy} r={12} fill="none" stroke={color} stroke-width="1.4" opacity="0.5" />}
            <circle cx={cx} cy={cy} r={9.5} fill={color} />
            <circle cx={cx} cy={cy} r={8} fill={avatarColor(commit.author)} />
            <text x={cx} y={cy} class="graph__initials" text-anchor="middle" dominant-baseline="central">{initials(commit.author)}</text>
            {avatar && (
              <image href={avatar} x={cx - 8} y={cy - 8} width={16} height={16} style={{ clipPath: 'circle(50%)' }} />
            )}
            {isSelected && <circle cx={cx} cy={cy} r={11} fill="none" stroke="var(--accent)" stroke-width="1.5" />}
          </g>
        );
      })}
    </svg>
  );
}
