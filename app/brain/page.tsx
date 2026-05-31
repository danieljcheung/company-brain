"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  Database,
  FileText,
  GitBranch,
  Loader2,
  Maximize2,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ApiRecord } from "@/app/lib/brainApi";

type Source = ApiRecord["provenance"][number];
type GraphNode =
  | { id: string; type: "record"; record: ApiRecord; x: number; y: number }
  | { id: string; type: "source"; source: Source; x: number; y: number };

function colorFor(section: string, sections: string[]) {
  const index = Math.max(0, sections.indexOf(section)) % 7;
  return `var(--section-color-${index})`;
}

function dateLabel(value: string | null) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function inferWorkflows(record: ApiRecord) {
  const text = `${record.section} ${record.title} ${record.body}`.toLowerCase();
  const workflows: Array<[string, string[]]> = [
    ["Inbox agent", ["inbox", "email", "gmail", "reply", "customer"]],
    ["Invoice workflow", ["invoice", "zoho", "pricing", "payment", "package"]],
    ["Event operations", ["event", "booking", "service", "setup", "stand"]],
    ["Knowledge review", ["review", "approve", "evidence", "source", "policy"]],
  ];
  const matches = workflows.filter(([, terms]) => terms.some((term) => text.includes(term)));
  return matches.map(([name]) => name);
}

interface PhysicsNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number;
  fy?: number;
  z?: number;
}

function Graph({
  records,
  selectedId,
  selectedSourceId,
  onRecord,
  onSource,
  sections,
  query,
}: {
  records: ApiRecord[];
  selectedId: string | null;
  selectedSourceId: string | null;
  onRecord: (record: ApiRecord) => void;
  onSource: (source: Source) => void;
  sections: string[];
  query?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Ideal cluster targets
  const { initialNodes, initialLinks } = useMemo(() => {
    const cx = 500;
    const cy = 360;
    const grouped = sections
      .map((section) => records.filter((record) => record.section === section))
      .filter((group) => group.length);

    const recordNodes: GraphNode[] = grouped.flatMap((group, groupIndex) => {
      const clusterAngle = (groupIndex / Math.max(1, grouped.length)) * Math.PI * 2 - Math.PI / 2;
      const clusterRadius = grouped.length === 1 ? 0 : 205;
      const clusterX = cx + Math.cos(clusterAngle) * clusterRadius;
      const clusterY = cy + Math.sin(clusterAngle) * clusterRadius;

      return [...group].sort((a, b) => a.title.localeCompare(b.title)).map((record, index) => {
        const ring = Math.floor(index / 9) + 1;
        const ringStart = (ring - 1) * 9;
        const count = Math.min(9, group.length - ringStart);
        const angle = (index - ringStart) / Math.max(1, count) * Math.PI * 2 - Math.PI / 2;
        const radius = group.length === 1 ? 0 : 30 + ring * 24;
        return {
          id: record.id,
          type: "record" as const,
          record,
          x: clusterX + Math.cos(angle) * radius,
          y: clusterY + Math.sin(angle) * radius,
        };
      });
    });

    const visibleIds = new Set(recordNodes.map((node) => node.id));
    const recordById = new Map(recordNodes.map((node) => [node.id, node]));
    const sourceMap = new Map<string, Source>();
    records.forEach((record) => record.provenance.forEach((source) => sourceMap.set(source.sourceId, source)));

    const sourceNodes: GraphNode[] = [...sourceMap.values()]
      .sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle))
      .map((source, index) => {
        const linked = records
          .filter((record) => record.provenance.some((item) => item.sourceId === source.sourceId))
          .map((record) => recordById.get(record.id))
          .filter(Boolean) as GraphNode[];
        const anchorX = linked.reduce((sum, node) => sum + node.x, 0) / Math.max(1, linked.length);
        const anchorY = linked.reduce((sum, node) => sum + node.y, 0) / Math.max(1, linked.length);
        const angle = (index * 2.399963) % (Math.PI * 2);
        return {
          id: source.sourceId,
          type: "source",
          source,
          x: anchorX + Math.cos(angle) * 55,
          y: anchorY + Math.sin(angle) * 55,
        };
      });

    const sourceIds = new Set(sourceNodes.map((node) => node.id));
    const edges: Array<{ from: string; to: string; type: "evidence" | "lineage" }> = [];
    records.forEach((record) => {
      if (!visibleIds.has(record.id)) return;
      record.provenance.forEach((source) => {
        if (sourceIds.has(source.sourceId)) {
          edges.push({ from: record.id, to: source.sourceId, type: "evidence" });
        }
      });
      if (record.supersedesId && visibleIds.has(record.supersedesId)) {
        edges.push({ from: record.id, to: record.supersedesId, type: "lineage" });
      }
    });

    return { initialNodes: [...recordNodes, ...sourceNodes], initialLinks: edges };
  }, [records, sections]);

  // Camera centering/scrolling on selection change
  useEffect(() => {
    const activeId = selectedSourceId ?? selectedId;
    if (!activeId) return;

    const nodePos = positionsRef.current[activeId] || initialNodes.find((n) => n.id === activeId);
    if (nodePos) {
      setView((current) => ({
        scale: current.scale,
        x: -(nodePos.x - 500) * current.scale,
        y: -(nodePos.y - 360) * current.scale,
      }));
    }
  }, [selectedId, selectedSourceId, initialNodes]);

  // Physics Simulation State
  const positionsRef = useRef<Record<string, PhysicsNode>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number; z?: number }>>(() => {
    const nextPositions: Record<string, { x: number; y: number; z?: number }> = {};
    const nextRef: Record<string, PhysicsNode> = {};
    initialNodes.forEach((node) => {
      nextPositions[node.id] = { x: 500, y: 360, z: 0 };
      nextRef[node.id] = {
        id: node.id,
        x: 500,
        y: 360,
        vx: 0,
        vy: 0,
        z: 0,
      };
    });
    positionsRef.current = nextRef;
    return nextPositions;
  });

  const isSimulatingRef = useRef(false);
  const frameIdRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggedNodeIdRef = useRef<string | null>(null);
  const tickCountRef = useRef<number>(0);
  const effectCountRef = useRef(0);
  const isFirstMountRef = useRef(true);
  const lastQueryRef = useRef(query || "");
  const initialNodesRef = useRef(initialNodes);
  const initialLinksRef = useRef(initialLinks);
  const viewRef = useRef(view);

  // Keep references fresh so loop can access them without dependencies
  useEffect(() => {
    initialNodesRef.current = initialNodes;
    initialLinksRef.current = initialLinks;
  }, [initialNodes, initialLinks]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Coordinate conversion helper
  function getSVGPoint(event: React.PointerEvent<SVGElement> | PointerEvent) {
    if (!svgRef.current) return { x: 500, y: 360 };
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * 1000;
    const svgY = ((event.clientY - rect.top) / rect.height) * 720;
    const currentView = viewRef.current;
    const x = (svgX - currentView.x - 500) / currentView.scale + 500;
    const y = (svgY - currentView.y - 360) / currentView.scale + 360;
    return { x, y };
  }

  // Define wakeUp function
  const wakeUp = () => {
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    if (frameIdRef.current !== null) {
      cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }
    isSimulatingRef.current = true;
    let alpha = 1.0;
    const tick = () => {
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
      const nodesMap = positionsRef.current;
      const nodeIds = Object.keys(nodesMap);
      if (nodeIds.length === 0) {
        isSimulatingRef.current = false;
        return;
      }

      const frame = tickCountRef.current;
      tickCountRef.current += 1;
      const N = nodeIds.length;

      if (frame < 280) {
        nodeIds.forEach((id, index) => {
          const n = nodesMap[id];
          if (!n) return;
          if (n.fx !== undefined && n.fy !== undefined) {
            n.x = n.fx;
            n.y = n.fy;
            n.vx = 0;
            n.vy = 0;
            n.z = 0;
            return;
          }

          const strand = index % 2 === 0 ? 0 : 1;
          const t = index / (N - 1 || 1); // 0 to 1 along helix axis
          
          // Grow progress from 0 to 1 over 180 frames (slowed down)
          const p = Math.min(frame / 180, 1.0);
          
          // Diagonal axis line from (200, 220) to (800, 500)
          const targetCx = 200 + t * 600;
          const targetCy = 220 + t * 280;
          const cx = 500 + (targetCx - 500) * p;
          const cy = 360 + (targetCy - 360) * p;
          
          const radius = 55 * p;
          const twistAngle = t * Math.PI * 4; // 2 full twists
          const spinAngle = frame * 0.05; // slow spin
          const strandOffset = strand * Math.PI;
          const totalAngle = twistAngle + spinAngle + strandOffset;

          const cosA = Math.cos(totalAngle);
          const sinA = Math.sin(totalAngle);

          // Perpendicular unit vector of diagonal axis
          // axisDx = 600, axisDy = 280
          // px = -280/662.1 = -0.4229, py = 600/662.1 = 0.9062
          const px = -0.4229;
          const py = 0.9062;

          n.x = cx + px * cosA * radius;
          n.y = cy + py * cosA * radius;
          n.z = sinA * p;
          n.vx = 0;
          n.vy = 0;
        });
      } else {
        // 1. Many-body repulsion
        let kRepulsion = 900;
        if (frame >= 280 && frame < 360) {
          const t = (frame - 280) / 80;
          kRepulsion = 100 + t * 800;
        }
        for (let i = 0; i < nodeIds.length; i += 1) {
          const id1 = nodeIds[i];
          const n1 = nodesMap[id1];
          for (let j = i + 1; j < nodeIds.length; j += 1) {
            const id2 = nodeIds[j];
            const n2 = nodesMap[id2];

            const dx = n1.x - n2.x;
            const dy = n1.y - n2.y;
            let distSq = dx * dx + dy * dy;
            if (distSq < 1) distSq = 1;
            const dist = Math.sqrt(distSq);

            const force = kRepulsion / distSq;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            n1.vx += fx;
            n1.vy += fy;
            n2.vx -= fx;
            n2.vy -= fy;
          }
        }

        // 2. Spring attraction (links)
        let kSpring = 0.035;
        if (frame >= 280 && frame < 360) {
          const t = (frame - 280) / 80;
          kSpring = 0.01 + t * 0.025;
        }
        const lDesired = 70;
        initialLinksRef.current.forEach((link) => {
          const n1 = nodesMap[link.from];
          const n2 = nodesMap[link.to];
          if (!n1 || !n2) return;

          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const displacement = dist - lDesired;
          const force = kSpring * displacement;

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          n1.vx += fx;
          n1.vy += fy;
          n2.vx -= fx;
          n2.vy -= fy;
        });

        // 3. Target clustering / Gravity
        let kCenter = 0.015;
        if (frame >= 280 && frame < 360) {
          const t = (frame - 280) / 80;
          kCenter = 0.003 + t * 0.012;
        }
        initialNodesRef.current.forEach((node) => {
          const n = nodesMap[node.id];
          if (!n) return;

          const dx = node.x - n.x;
          const dy = node.y - n.y;
          n.vx += dx * kCenter;
          n.vy += dy * kCenter;

          const cdx = 500 - n.x;
          const cdy = 360 - n.y;
          n.vx += cdx * 0.0015;
          n.vy += cdy * 0.0015;
        });
      }

      // 4. Update coordinates & compute total motion heat
      let friction = 0.85;
      if (frame >= 280 && frame < 360) {
        const t = (frame - 280) / 80;
        friction = 0.5 + t * 0.35;
      }
      const nextPositions: Record<string, { x: number; y: number; z?: number }> = {};
      let totalVelocity = 0;

      nodeIds.forEach((id) => {
        const n = nodesMap[id];
        if (n.fx !== undefined && n.fy !== undefined) {
          n.x = n.fx;
          n.y = n.fy;
          n.vx = 0;
          n.vy = 0;
          n.z = 0;
        } else if (frame >= 280) {
          n.x += n.vx;
          n.y += n.vy;
          n.vx *= friction;
          n.vy *= friction;
          if (n.z !== undefined) {
            n.z *= 0.92; // Decay 3D depth to 2D
          }
        }

        n.x = Math.max(60, Math.min(940, n.x));
        n.y = Math.max(50, Math.min(670, n.y));

        nextPositions[id] = { x: n.x, y: n.y, z: n.z };
        totalVelocity += Math.abs(n.vx) + Math.abs(n.vy);
      });

      setPositions(nextPositions);

      alpha = totalVelocity > 0.05 ? 1.0 : alpha * 0.95;

      if (totalVelocity > 0.02 || draggedNodeIdRef.current || tickCountRef.current < 400) {
        scheduleNext();
      } else {
        isSimulatingRef.current = false;
      }
    };
    const scheduleNext = () => {
      const rafId = requestAnimationFrame(tick);
      const tmId = setTimeout(() => {
        cancelAnimationFrame(rafId);
        tick();
      }, 30); // ~33fps fallback
      frameIdRef.current = rafId;
      timeoutIdRef.current = tmId;
    };
    scheduleNext();
  };


  // Sync React list changes with physics coordinates
  useEffect(() => {
    effectCountRef.current += 1;
    console.log("EFFECT_COUNT_LOG:", effectCountRef.current);
    const current = positionsRef.current;
    const next: Record<string, PhysicsNode> = {};

    initialNodes.forEach((node) => {
      if (current[node.id]) {
        next[node.id] = current[node.id];
      } else {
        next[node.id] = {
          id: node.id,
          x: 500,
          y: 360,
          vx: 0,
          vy: 0,
          z: 0,
        };
      }
    });
    const isSearchTyping = query !== undefined && query !== lastQueryRef.current;
    lastQueryRef.current = query || "";

    if (isFirstMountRef.current) {
      tickCountRef.current = 0;
      isFirstMountRef.current = false;
    } else if (isSearchTyping) {
      tickCountRef.current = 280;
    } else {
      tickCountRef.current = 0;
    }
    positionsRef.current = next;
    // Sync initial positions synchronously to avoid empty nodes on first paint
    const nextPositions: Record<string, { x: number; y: number; z?: number }> = {};
    initialNodes.forEach((node) => {
      const n = next[node.id];
      nextPositions[node.id] = { x: n.x, y: n.y, z: n.z };
    });
    setPositions(nextPositions);
    wakeUp();
  }, [initialNodes, query]);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
      }
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
      }
    };
  }, []);

  const prevDragPointRef = useRef<{ x: number; y: number } | null>(null);

  // Drag handers for pulling whole graph
  const handleNodePointerDown = (id: string, event: React.PointerEvent<SVGElement>) => {
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (err) {
      console.warn("Failed to set pointer capture:", err);
    }
    const point = getSVGPoint(event);
    draggedNodeIdRef.current = id;
    prevDragPointRef.current = point;

    const n = positionsRef.current[id];
    if (n) {
      n.fx = point.x;
      n.fy = point.y;
    }
    wakeUp();
  };

  const handleNodePointerMove = (event: React.PointerEvent<SVGElement>) => {
    const draggedId = draggedNodeIdRef.current;
    if (!draggedId || !prevDragPointRef.current) return;
    const point = getSVGPoint(event);
    const dx = point.x - prevDragPointRef.current.x;
    const dy = point.y - prevDragPointRef.current.y;
    prevDragPointRef.current = point;

    const nodesMap = positionsRef.current;
    const nDragged = nodesMap[draggedId];
    if (nDragged) {
      nDragged.fx = point.x;
      nDragged.fy = point.y;
    }

    // Pull all other nodes elastically
    Object.keys(nodesMap).forEach((id) => {
      if (id !== draggedId) {
        const n = nodesMap[id];
        n.x += dx * 0.42;
        n.y += dy * 0.42;
        n.vx += dx * 0.08;
        n.vy += dy * 0.08;
      }
    });
    wakeUp();
  };

  const handleNodePointerUp = (event: React.PointerEvent<SVGElement>) => {
    const draggedId = draggedNodeIdRef.current;
    if (draggedId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (err) {
        console.warn("Failed to release pointer capture:", err);
      }
      const n = positionsRef.current[draggedId];
      if (n) {
        delete n.fx;
        delete n.fy;
      }
      draggedNodeIdRef.current = null;
      prevDragPointRef.current = null;
    }
  };
  const focusId = hoveredId ?? selectedSourceId ?? selectedId;
  const nodeById = useMemo(() => new Map(initialNodes.map((node) => [node.id, node])), [initialNodes]);
  const relatedIds = new Set([
    focusId,
    ...initialLinks
      .filter((link) => link.from === focusId || link.to === focusId)
      .flatMap((link) => [link.from, link.to]),
  ]);
  const zoom = (factor: number) =>
    setView((current) => ({
      ...current,
      scale: Math.min(2.6, Math.max(0.55, current.scale * factor)),
    }));
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden">
      <svg
        ref={svgRef}
        className="h-full min-h-[420px] w-full touch-none cursor-grab active:cursor-grabbing"
        viewBox="0 0 1000 720"
        role="group"
        aria-label="Interactive company knowledge graph. Drag nodes to pull, tab to navigate."
        onWheel={(event) => {
          event.preventDefault();
          zoom(event.deltaY > 0 ? 0.9 : 1.1);
        }}
        onPointerDown={(event) => {
          if (event.target === svgRef.current || (event.target as SVGElement).tagName === "rect") {
            dragRef.current = {
              x: event.clientX,
              y: event.clientY,
              panX: view.x,
              panY: view.y,
            };
          }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag) {
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            setView((current) => ({
              ...current,
              x: drag.panX + dx,
              y: drag.panY + dy,
            }));
          }
        }}
        onPointerUp={() => {
          dragRef.current = null;
          const draggedId = draggedNodeIdRef.current;
          if (draggedId) {
            const n = positionsRef.current[draggedId];
            if (n) {
              delete n.fx;
              delete n.fy;
            }
            draggedNodeIdRef.current = null;
            prevDragPointRef.current = null;
          }
        }}
        onPointerLeave={() => {
          dragRef.current = null;
          const draggedId = draggedNodeIdRef.current;
          if (draggedId) {
            const n = positionsRef.current[draggedId];
            if (n) {
              delete n.fx;
              delete n.fy;
            }
            draggedNodeIdRef.current = null;
            prevDragPointRef.current = null;
          }
        }}
      >
        <defs>
          <style>
            {`
              .graph-edge-base {
                stroke-linecap: round;
                transition: stroke-opacity 0.3s;
              }
              .graph-edge-glow {
                stroke-dasharray: 5 15;
                stroke-linecap: round;
                animation: graph-pulse-flow 5s linear infinite;
              }
              .graph-edge-lineage-base {
                stroke-dasharray: 6 4;
                stroke-linecap: round;
                transition: stroke-opacity 0.3s;
              }
              .graph-edge-lineage-glow {
                stroke-dasharray: 6 12;
                stroke-linecap: round;
                animation: graph-pulse-flow 5s linear infinite;
              }
              .graph-edge-active {
                animation-duration: 2.5s;
              }
              @keyframes graph-pulse-flow {
                to {
                  stroke-dashoffset: -80;
                }
              }
              .node-pulse {
                animation: ring-pulse 2.5s infinite;
              }
              @keyframes ring-pulse {
                0% { r: 12px; opacity: 0.4; }
                50% { r: 24px; opacity: 0.1; }
                100% { r: 12px; opacity: 0.4; }
              }
              @media (prefers-reduced-motion: reduce) {
                .graph-edge-glow, .graph-edge-lineage-glow, .node-pulse {
                  animation: none;
                }
              }
            `}
          </style>
          <radialGradient id="graphGlow">
            <stop offset="0%" stopColor="#CEB195" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#CEB195" stopOpacity="0" />
          </radialGradient>
          <pattern id="graphGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" opacity="0.08" />
          </pattern>
        </defs>
        <rect width="1000" height="720" fill="url(#graphGrid)" />
        <g
          transform={`translate(${view.x} ${view.y}) translate(500 360) scale(${view.scale}) translate(-500 -360)`}
          className="transition-transform duration-75"
        >
          <circle cx="500" cy="360" r="300" fill="url(#graphGlow)" />
          {/* Render Connections */}
          {/* Render Connections */}
          {initialLinks.map((link, index) => {
            const from = positions[link.from];
            const to = positions[link.to];
            if (!from || !to) return null;
            const active = relatedIds.has(link.from) && relatedIds.has(link.to);
            const fromZ = from.z ?? 0;
            const toZ = to.z ?? 0;
            const avgZ = (fromZ + toZ) / 2;
            const depthFactor = 0.65 + avgZ * 0.35;
            const baseOpacity = focusId ? (active ? 0.75 : 0.1) : 0.15 * depthFactor;
            const glowOpacity = focusId ? (active ? 0.9 : 0) : 0.4 * depthFactor;
            const isLineage = link.type === "lineage";
            return (
              <g key={`${link.from}-${link.to}-${index}`}>
                {/* Background edge track */}
                <line
                  className={isLineage ? "graph-edge-lineage-base" : "graph-edge-base"}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isLineage ? "#8b5cf6" : "currentColor"}
                  strokeOpacity={baseOpacity.toString()}
                  strokeWidth={active ? (isLineage ? 3 : 2) : 1}
                />
                {/* Glowing flow animation overlay */}
                <line
                  className={`${isLineage ? "graph-edge-lineage-glow" : "graph-edge-glow"} ${active ? "graph-edge-active" : ""}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isLineage ? "#a78bfa" : "#CEB195"}
                  strokeOpacity={glowOpacity.toString()}
                  strokeWidth={active ? (isLineage ? 3.5 : 2.5) : 1.5}
                />
              </g>
            );
          })}
          {/* Render Nodes */}
          {/* Render Nodes */}
          {(() => {
            const needsSort = tickCountRef.current < 320;
            const nodesWithPos = initialNodes.map((node) => ({ node, pos: positions[node.id] })).filter((x) => x.pos);
            if (needsSort) {
              nodesWithPos.sort((a, b) => (a.pos.z ?? 0) - (b.pos.z ?? 0));
            }
            return nodesWithPos.map(({ node, pos }) => {
              const active = node.type === "source" ? selectedSourceId === node.id : selectedId === node.id;
              const highlighted = focusId ? (relatedIds.has(node.id) || active) : true;
              const isHovered = hoveredId === node.id;
              
              const z = pos.z ?? 0;
              const depthScale = 0.85 + z * 0.25;

              if (node.type === "source") {
                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x} ${pos.y})`}
                    className="cursor-grab outline-none select-none active:cursor-grabbing"
                    onPointerDown={(e) => handleNodePointerDown(node.id, e)}
                    onPointerMove={handleNodePointerMove}
                    onPointerUp={handleNodePointerUp}
                    onClick={() => onSource(node.source)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSource(node.source);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open source: ${node.source.sourceTitle}`}
                    opacity={highlighted ? (0.7 + z * 0.3) : 0.42}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <title>{node.source.sourceTitle}</title>
                    {/* Outer active highlight ring */}
                    {active && (
                      <rect
                        x="-13"
                        y="-13"
                        width="26"
                        height="26"
                        rx="4"
                        style={{
                          transform: `rotate(45deg) scale(${ (isHovered ? 1.25 : 1.0) * depthScale })`,
                          transformOrigin: "0px 0px",
                        }}
                        className="transition-transform duration-200 pointer-events-none"
                        stroke="#CEB195"
                        strokeOpacity="0.4"
                        strokeWidth="2"
                      />
                    )}
                    {/* Diamond shape representation */}
                    <rect
                      x="-8"
                      y="-8"
                      width="16"
                      height="16"
                      rx="3"
                      style={{
                        transform: `rotate(45deg) scale(${ (isHovered ? 1.25 : 1.0) * depthScale })`,
                        transformOrigin: "0px 0px",
                      }}
                      className="transition-transform duration-200"
                      fill={isHovered || active ? "rgba(206, 177, 149, 0.15)" : "var(--background)"}
                      stroke={isHovered || active ? "#CEB195" : "currentColor"}
                      strokeOpacity={isHovered || active ? 1 : 0.6}
                      strokeWidth={active ? 3 : 2}
                    />
                    {(isHovered || active) && (
                      <text
                        y="26"
                        textAnchor="middle"
                        fill="currentColor"
                        fontSize="9"
                        fontWeight="600"
                        className="drop-shadow-sm select-none pointer-events-none"
                      >
                        {node.source.sourceTitle}
                      </text>
                    )}
                  </g>
                );
              }
              // Record Node
              const color = colorFor(node.record.section, sections);
              const radius = active ? 16 : 10 + Math.min(node.record.provenance.length, 4);
              return (
                <g
                  key={node.id}
                  className="cursor-grab outline-none select-none active:cursor-grabbing"
                  onPointerDown={(e) => handleNodePointerDown(node.id, e)}
                  onPointerMove={handleNodePointerMove}
                  onPointerUp={handleNodePointerUp}
                  onClick={() => onRecord(node.record)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRecord(node.record);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open record: ${node.record.title}. ${node.record.provenance.length} evidence sources.`}
                  opacity={highlighted ? (0.7 + z * 0.3) : 0.4}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <title>
                    {node.record.title} · {node.record.sectionLabel} · {node.record.provenance.length} sources
                  </title>
                  {/* Pulse highlight */}
                  {active && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={(radius + 8) * depthScale}
                      fill={color}
                      opacity="0.15"
                      style={{
                        transform: `scale(${isHovered ? 1.1 : 1})`,
                        transformOrigin: `${pos.x}px ${pos.y}px`,
                      }}
                      className="node-pulse pointer-events-none transition-transform duration-200"
                    />
                  )}
                  {/* Main node bubble */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={radius * depthScale}
                    fill={color}
                    opacity={active ? 1 : 0.85}
                    stroke="var(--background)"
                    strokeWidth="3.5"
                    style={{
                      transform: `scale(${isHovered ? 1.1 : 1})`,
                      transformOrigin: `${pos.x}px ${pos.y}px`,
                    }}
                    className="transition-transform duration-200"
                  />
                  {/* Glowing border if selected */}
                  {active && (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={(radius + 3) * depthScale}
                      fill="none"
                      stroke="#CEB195"
                      strokeWidth="1.5"
                      style={{
                        transform: `scale(${isHovered ? 1.1 : 1})`,
                        transformOrigin: `${pos.x}px ${pos.y}px`,
                      }}
                      className="pointer-events-none transition-transform duration-200"
                    />
                  )}
                  {(active || isHovered || records.length < 18) && (
                    <text
                      x={pos.x}
                      y={pos.y + (radius * depthScale) + 15}
                      textAnchor="middle"
                      fill="currentColor"
                      fontSize="10"
                      fontWeight="600"
                      className="drop-shadow-sm select-none pointer-events-none"
                    >
                      {node.record.title.length > 28
                        ? `${node.record.title.slice(0, 27)}…`
                        : node.record.title}
                    </text>
                  )}
                </g>
              );
            });
          })()}
        </g>
      </svg>

      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button size="icon" variant="ghost" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.18)}>
          <ZoomIn className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(0.84)}>
          <ZoomOut className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Fit graph" title="Fit graph" onClick={reset}>
          <Maximize2 className="size-4" />
        </Button>
      </div>

      {selectedId && nodeById.get(selectedId)?.type === "record" && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-11rem)] rounded-md border bg-background/90 px-3 py-2 shadow-sm backdrop-blur xl:hidden">
          <div className="truncate text-sm font-semibold">
            {(nodeById.get(selectedId) as Extract<GraphNode, { type: "record" }>).record.title}
          </div>
          <div className="text-xs text-muted-foreground">Selected record</div>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {hoveredId ? `Focused graph node ${hoveredId}` : ""}
      </div>
    </div>
  );
}
export default function BrainPage() {
  const [records, setRecords] = useState<ApiRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "details">("list");
  const [source, setSource] = useState<Source | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", section: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const selected = records.find((record) => record.id === selectedId) ?? null;
  const supersedesRecord = selected?.supersedesId ? records.find((r) => r.id === selected.supersedesId) : null;
  const supersededByRecords = selected ? records.filter((r) => r.supersedesId === selected.id) : [];
  const sharedSourceIds = useMemo(() => new Set(selected?.provenance.map((p) => p.sourceId) ?? []), [selected]);
  const relatedRecords = useMemo(() => {
    if (!selected) return [];
    return records.filter((r) => r.id !== selected.id && r.provenance.some((p) => sharedSourceIds.has(p.sourceId)));
  }, [records, selected, sharedSourceIds]);
  const dirty = editing && selected ? draft.title !== selected.title || draft.body !== selected.body || draft.section !== selected.section : false;

  const allowChange = useCallback(() => {
    return !dirty || window.confirm("Discard unsaved record changes?");
  }, [dirty]);

  async function loadRecords(force = false) {
    if (!force && !allowChange()) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/brain/records");
      if (!response.ok) throw new Error("Could not load Company Brain records.");
      const data = (await response.json()) as { records: ApiRecord[] };
      setRecords(data.records);
      setSelectedId((current) => current ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Company Brain.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecords(true);
    // Initial data load is intentionally independent of edit state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allSections = useMemo(() => [...new Set(records.map((record) => record.section))].sort(), [records]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      const sectionMatch = sections.length === 0 || sections.includes(record.section);
      const queryMatch = !needle || `${record.title} ${record.body} ${record.sectionLabel}`.toLowerCase().includes(needle);
      return sectionMatch && queryMatch;
    });
  }, [query, records, sections]);
  const evidenceCount = records.reduce((sum, record) => sum + record.provenance.length, 0);
  const openQuestions = records.flatMap((record) => record.questions.filter((question) => question.status !== "ANSWERED"));

  useEffect(() => {
    if (selectedId === null) return;
    if (filtered.some((record) => record.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
    setSource(null);
    setEditing(false);
  }, [filtered, selectedId]);

  const selectRecord = useCallback((record: ApiRecord) => {
    if (!allowChange()) return;
    setSelectedId(record.id);
    setSource(null);
    setEditing(false);
    setMobileView("details");
  }, [allowChange]);

  function beginEdit() {
    if (!selected) return;
    setDraft({ title: selected.title, body: selected.body, section: selected.section });
    setEditing(true);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/brain/records/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, note: "Edited from operational knowledge graph." }),
      });
      if (!response.ok) throw new Error("Could not save record.");
      await loadRecords(true);
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save record.");
    } finally {
      setSaving(false);
    }
  }

  return (
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/15">
        <div className="flex flex-wrap items-center gap-3 border-b border-accent/25 bg-background/95 px-4 py-3 shadow-sm">
          <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500 mr-1.5 shrink-0">
            <Database className="size-5" />
          </div>
          <div className="mr-auto min-w-0">
            <h1 className="text-base font-semibold tracking-tight">Company Brain</h1>
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading approved records...</p>
            ) : (
              <p className="text-xs text-muted-foreground">{records.length} records · {evidenceCount} links · {openQuestions.length} gaps</p>
            )}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input aria-label="Search Company Brain" value={query} onChange={(event) => { if (allowChange()) setQuery(event.target.value); }} placeholder="Search knowledge..." className="pl-9 bg-background/50 focus-visible:ring-1" />
          </div>
          <Button variant="outline" size="icon" onClick={() => void loadRecords()} title="Refresh records" aria-label="Refresh records" disabled={loading} className="size-9"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>

        {error && <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive"><AlertCircle className="size-4" />{error}</div>}
        {saved && <div className="flex items-center gap-2 border-b bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300"><Check className="size-4" />Record saved.</div>}

        <div className="border-b bg-background p-3 hidden md:block xl:hidden">
          <label htmlFor="mobile-record-navigator" className="mb-1.5 block text-xs font-semibold uppercase text-muted-foreground">
            Visible record
          </label>
          <select
            id="mobile-record-navigator"
            aria-label="Select a visible Company Brain record"
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={selectedId ?? ""}
            onChange={(event) => {
              const record = filtered.find((item) => item.id === event.target.value);
              if (record) selectRecord(record);
            }}
            disabled={filtered.length === 0}
          >
            {filtered.length === 0 ? <option value="">No matching records</option> : null}
            {filtered.map((record) => <option key={record.id} value={record.id}>{record.sectionLabel}: {record.title}</option>)}
          </select>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {filtered.length} visible records · {new Set(filtered.flatMap((record) => record.provenance.map((item) => item.sourceId))).size} connected sources
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_1fr_320px] xl:grid-cols-[280px_minmax(420px,1fr)_380px]">
          <aside className={`${mobileView === "list" ? "flex" : "hidden"} md:flex min-h-0 border-r bg-background flex-col`}>
            <div className="flex gap-2 overflow-x-auto p-3 border-b shrink-0 xl:flex-col xl:overflow-x-visible xl:p-4">
              <div className="hidden xl:block mb-3 text-xs font-semibold uppercase text-muted-foreground">Categories</div>
              <button
                onClick={() => { if (allowChange()) setSections([]); }}
                className={`shrink-0 w-auto xl:w-full xl:mb-1.5 flex items-center justify-between rounded-lg px-3 py-2 text-sm border border-accent/10 transition-all hover:bg-muted ${sections.length === 0 ? "bg-accent/20 font-semibold text-foreground border-l-4 border-l-blue-500" : "bg-muted/30"}`}
              >
                All <span className="ml-1 text-xs text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded-full">{records.length}</span>
              </button>
              {allSections.map((section) => {
                const color = colorFor(section, allSections);
                const isActive = sections.includes(section);
                return (
                  <button
                    key={section}
                    onClick={() => { if (allowChange()) setSections((current) => current.includes(section) ? current.filter((item) => item !== section) : [...current, section]); }}
                    className={`shrink-0 w-auto xl:w-full xl:mb-1.5 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm border border-accent/10 transition-all hover:bg-muted ${isActive ? "bg-accent/20 font-semibold text-foreground border-l-4" : "bg-muted/30"}`}
                    style={isActive ? { borderLeftColor: color } : undefined}
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ background: color }} />
                    <span className="min-w-0 truncate flex-1">{records.find((record) => record.section === section)?.sectionLabel ?? section}</span>
                    <span className="text-xs text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded-full">{records.filter((record) => record.section === section).length}</span>
                  </button>
                );
              })}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-3">
                <div className="mb-2 px-1 text-xs font-semibold uppercase text-muted-foreground">Visible records</div>
                {filtered.map((record) => {
                  const color = colorFor(record.section, allSections);
                  const isSelected = selectedId === record.id;
                  return (
                    <button
                      key={record.id}
                      onClick={() => selectRecord(record)}
                      className={`mb-2 flex w-full items-center gap-2.5 rounded-lg border border-accent/15 px-3 py-2.5 text-left text-sm transition-all hover:bg-muted ${isSelected ? "bg-accent/20 font-semibold text-foreground border-l-4" : "bg-muted/15"}`}
                      style={isSelected ? { borderLeftColor: color } : undefined}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{record.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground mt-0.5">{record.sectionLabel} · {record.provenance.length} {record.provenance.length === 1 ? "source" : "sources"}</span>
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/75" />
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </aside>

          <section className="hidden md:flex relative min-h-[62vh] overflow-hidden border-b bg-background xl:min-h-0 xl:border-b-0 xl:border-r flex-col">
            {loading ? (
              <div className="flex h-full min-h-[480px] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Mapping company knowledge...</div>
            ) : records.length === 0 ? (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <Database className="size-6 opacity-50" />
                <span>No approved records yet.</span>
              </div>
            ) : filtered.length ? (
              <>
                <Graph records={filtered} selectedId={selectedId} selectedSourceId={source?.sourceId ?? null} onRecord={selectRecord} onSource={setSource} sections={allSections} query={query} />
                <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-accent/25 bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-sky-500" />Record</span>
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full border border-foreground/50" />Source</span>
                  <span className="border-l pl-3">{filtered.length} visible</span>
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <Search className="size-6 opacity-50" />
                <span>No records match these filters.</span>
                <Button variant="outline" size="sm" onClick={() => { setQuery(""); setSections([]); }}>Clear filters</Button>
              </div>
            )}
          </section>

          <aside className={`${mobileView === "details" ? "flex" : "hidden"} md:flex min-h-0 bg-background flex-col`}>
            <ScrollArea className="h-full max-h-[70vh] xl:max-h-none">
              {source ? (
                <div className="p-4">
                  <div className="mb-4 md:hidden">
                    <Button variant="ghost" size="sm" onClick={() => setMobileView("list")} className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                      <ChevronRight className="mr-1 size-4 rotate-180" /> Back to list
                    </Button>
                  </div>
                  <div className="mb-4 flex items-center gap-3 border-b border-accent/20 pb-3">
                    <div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-500"><FileText className="size-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Source preview</div>
                      <h2 className="mt-0.5 font-semibold text-foreground truncate leading-5">{source.sourceTitle}</h2>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSource(null)} className="size-8" aria-label="Close source preview"><X className="size-4" /></Button>
                  </div>
                  <dl className="mt-4 grid grid-cols-[90px_1fr] gap-y-2 text-xs">
                    <dt className="text-muted-foreground">Imported</dt><dd>{dateLabel(source.importedAt)}</dd>
                    <dt className="text-muted-foreground">Locator</dt><dd>{source.locator || "Whole source"}</dd>
                    <dt className="text-muted-foreground">Hash</dt><dd className="truncate font-mono">{source.contentHash}</dd>
                  </dl>
                  <div className="mt-5 border-t pt-4"><div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Evidence excerpt</div><p className="whitespace-pre-wrap text-sm leading-6">{source.evidence || "No excerpt stored."}</p></div>
                </div>
              ) : selected ? (
                <div className="p-4">
                  <div className="mb-4 md:hidden">
                    <Button variant="ghost" size="sm" onClick={() => setMobileView("list")} className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                      <ChevronRight className="mr-1 size-4 rotate-180" /> Back to list
                    </Button>
                  </div>
                  <div className="mb-4 flex items-center gap-3 border-b border-accent/20 pb-3">
                    <div className="rounded-lg p-2.5 text-white shadow-sm" style={{ background: colorFor(selected.section, allSections) }}><Database className="size-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{selected.sectionLabel}</div>
                      <h2 className="mt-0.5 text-base font-semibold leading-5 text-foreground">{selected.title}</h2>
                    </div>
                    {!editing && <Button variant="ghost" size="icon" onClick={beginEdit} className="size-8" title="Edit record" aria-label="Edit selected record"><Pencil className="size-4" /></Button>}
                  </div>
                  {editing ? (
                    <div className="space-y-3">
                      <label htmlFor="record-title" className="sr-only">Record title</label>
                      <Input id="record-title" aria-label="Record title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                      <label htmlFor="record-section" className="sr-only">Record category</label>
                      <select id="record-section" aria-label="Record category" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={draft.section} onChange={(event) => setDraft({ ...draft, section: event.target.value })}>
                        {allSections.map((section) => <option key={section} value={section}>{records.find((record) => record.section === section)?.sectionLabel ?? section}</option>)}
                      </select>
                      <label htmlFor="record-body" className="sr-only">Record content</label>
                      <Textarea id="record-body" aria-label="Record content" className="min-h-48" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
                      {dirty && <p className="text-xs text-amber-600 dark:text-amber-300">Unsaved changes</p>}
                      <div className="flex gap-2"><Button aria-label="Save record changes" onClick={() => void save()} disabled={saving || !dirty}><Save className="size-4" />{saving ? "Saving..." : "Save"}</Button><Button aria-label="Cancel editing record" variant="outline" onClick={() => setEditing(false)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-wrap text-sm leading-6">{selected.body}</p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="outline">v{selected.version}</Badge><span>Reviewed by {selected.reviewer}</span><span>Updated {dateLabel(selected.updatedAt)}</span></div>
                    </>
                  )}

                  {!editing && (
                    <Tabs defaultValue="overview" className="mt-6 border-t pt-4">
                      <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="overview" className="px-1 text-xs sm:text-sm">Overview</TabsTrigger>
                        <TabsTrigger value="metadata" className="px-1 text-xs sm:text-sm">Metadata</TabsTrigger>
                        <TabsTrigger value="evidence" className="px-1 text-xs sm:text-sm">Evidence</TabsTrigger>
                        <TabsTrigger value="history" className="px-1 text-xs sm:text-sm">History</TabsTrigger>
                      </TabsList>
                      <TabsContent value="overview" className="space-y-6 pt-3">
                        <section>
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><Bot className="size-3.5" />Agent and workflow usage</div>
                        <div className="space-y-2">
                          {inferWorkflows(selected).length ? inferWorkflows(selected).map((workflow) => <div key={workflow} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"><Sparkles className="size-3.5 text-amber-500" />{workflow}<Check className="ml-auto size-3.5 text-emerald-500" /></div>) : <p className="text-sm text-muted-foreground">No workflow references inferred.</p>}
                        </div>
                        </section>
                      <section>
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><AlertCircle className="size-3.5" />Gaps and questions</div>
                        {selected.questions.length ? selected.questions.map((question) => <div key={question.id} className="mb-2 rounded-md border p-3"><div className="flex gap-2 text-sm font-medium">{question.status === "ANSWERED" ? <Check className="mt-0.5 size-3.5 text-emerald-500" /> : <AlertCircle className="mt-0.5 size-3.5 text-amber-500" />}{question.title}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{question.answer || question.body}</p></div>) : <p className="text-sm text-muted-foreground">No open questions attached.</p>}
                        </section>
                      <section className="border-t pt-4 mt-6">
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><GitBranch className="size-3.5" />Version Lineage</div>
                        <div className="space-y-2">
                          {supersedesRecord && (
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Supersedes (Older Version)</span>
                              <button onClick={() => selectRecord(supersedesRecord)} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
                                <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
                                <span className="min-w-0 flex-1 truncate font-medium">{supersedesRecord.title}</span>
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                              </button>
                            </div>
                          )}
                          {supersededByRecords.length > 0 && (
                            <div className="flex flex-col gap-1">
                              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Superseded By (Newer Version)</span>
                              {supersededByRecords.map((newer) => (
                                <button key={newer.id} onClick={() => selectRecord(newer)} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
                                  <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                                  <span className="min-w-0 flex-1 truncate font-medium">{newer.title}</span>
                                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                                </button>
                              ))}
                            </div>
                          )}
                          {!supersedesRecord && supersededByRecords.length === 0 && (
                            <p className="text-sm text-muted-foreground">This is the only version of this record.</p>
                          )}
                        </div>
                      </section>
                      </TabsContent>
                      <TabsContent value="metadata" className="pt-3">
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><Database className="size-3.5" />Structured Metadata</div>
                        {selected.structuredData && Object.keys(selected.structuredData).length > 0 ? (
                          <div className="space-y-3">
                            <table className="w-full table-fixed border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b font-semibold text-muted-foreground">
                                  <th className="w-1/3 py-2 pr-4">Key</th>
                                  <th className="w-2/3 py-2">Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(selected.structuredData).map(([key, value]) => (
                                  <tr key={key} className="border-b last:border-0 hover:bg-muted/10">
                                    <td className="w-1/3 break-all py-2 pr-4 align-top font-mono font-medium text-muted-foreground">{key}</td>
                                    <td className="w-2/3 break-all py-2 align-top">
                                      {typeof value === "object" ? (
                                        <div className="min-w-0 overflow-x-auto">
                                          <pre className="mt-1 max-h-40 rounded bg-muted/30 p-2 font-mono text-[10px] leading-4">
                                            {JSON.stringify(value, null, 2)}
                                          </pre>
                                        </div>
                                      ) : (
                                        <span className="font-medium">{String(value)}</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground text-center">No structured metadata fields.</div>
                        )}
                      </TabsContent>
                      <TabsContent value="evidence" className="pt-3 space-y-6">
                        <div>
                          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><GitBranch className="size-3.5" />Evidence and provenance</div>
                          <div className="space-y-2">
                            {selected.provenance.length ? selected.provenance.map((item) => <button key={item.sourceId} onClick={() => setSource(item)} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"><FileText className="size-3.5 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate">{item.sourceTitle}</span><span className="block truncate text-xs text-muted-foreground">{item.sourceTypeLabel} · {item.locator || "Whole source"}</span></span><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" /></button>) : <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">System-synced context. No evidence source attached.</div>}
                          </div>
                        </div>
                        <div>
                          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><Database className="size-3.5" />Related Records (Shared Sources)</div>
                          <div className="space-y-2">
                            {relatedRecords.length ? relatedRecords.map((item) => (
                              <button key={item.id} onClick={() => selectRecord(item)} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted">
                                <span className="size-2 shrink-0 rounded-full" style={{ background: colorFor(item.section, allSections) }} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{item.title}</span>
                                  <span className="block truncate text-xs text-muted-foreground">{item.sectionLabel}</span>
                                </span>
                                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                              </button>
                            )) : <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground text-center">No other records share these sources.</div>}
                          </div>
                        </div>
                      </TabsContent>
                      <TabsContent value="history" className="pt-3">
                        <section>
                        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><CalendarClock className="size-3.5" />Timeline</div>
                        <div className="space-y-3">
                          {selected.timeline.length ? selected.timeline.map((event) => <div key={event.id} className="grid grid-cols-[8px_1fr] gap-3 text-sm"><span className="mt-1.5 size-2 rounded-full bg-foreground/40" /><div><div className="font-medium">{event.action.replaceAll("_", " ")}</div><div className="text-xs text-muted-foreground">{event.actor} · {dateLabel(event.createdAt)}</div>{event.note && <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>}</div></div>) : <p className="text-sm text-muted-foreground">No recent review events.</p>}
                        </div>
                        </section>
                      </TabsContent>
                    </Tabs>
                  )}
                </div>
              ) : (
                <div className="p-6 text-sm text-muted-foreground">Select a knowledge node to inspect it.</div>
              )}
            </ScrollArea>
          </aside>
        </div>
      </main>
  );
}
