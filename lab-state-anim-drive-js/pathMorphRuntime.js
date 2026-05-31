// Generated from src/editor/pathMorph.ts for standalone lab-state-anim-drive. Do not edit by hand.

// src/editor/pen.ts
var MIN_HANDLE_LENGTH = 1e-3;
function clonePoint(point) {
  return {
    x: point.x,
    y: point.y
  };
}
function clonePenPoint(point) {
  return {
    ...point,
    in: point.in ? clonePoint(point.in) : point.in,
    out: point.out ? clonePoint(point.out) : point.out
  };
}
function clonePenPoints(points) {
  return points.map(clonePenPoint);
}
function hasPenHandle(point, handle) {
  const offset2 = point[handle];
  return Boolean(offset2 && Math.hypot(offset2.x, offset2.y) > MIN_HANDLE_LENGTH);
}
function getPenHandlePoint(point, handle) {
  const offset2 = point[handle];
  return {
    x: point.x + (offset2?.x ?? 0),
    y: point.y + (offset2?.y ?? 0)
  };
}
function getPenSegmentCount(points, closed) {
  if (points.length < 2) {
    return 0;
  }
  return closed && points.length > 2 ? points.length : points.length - 1;
}
function getPenSegmentEndIndex(points, segmentIndex, closed) {
  if (segmentIndex < points.length - 1) {
    return segmentIndex + 1;
  }
  return closed ? 0 : -1;
}
function getPenSegmentControls(points, segmentIndex, closed) {
  const start = points[segmentIndex];
  const endIndex = getPenSegmentEndIndex(points, segmentIndex, closed);
  const end = endIndex >= 0 ? points[endIndex] : null;
  if (!start || !end) {
    return null;
  }
  return {
    start,
    end,
    endIndex,
    cp1: getPenHandlePoint(start, "out"),
    cp2: getPenHandlePoint(end, "in"),
    hasCurve: hasPenHandle(start, "out") || hasPenHandle(end, "in")
  };
}
function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}
function cubicPoint(p0, cp1, cp2, p1, t) {
  const p01 = lerpPoint(p0, cp1, t);
  const p12 = lerpPoint(cp1, cp2, t);
  const p23 = lerpPoint(cp2, p1, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  return lerpPoint(p012, p123, t);
}
function pointDelta(from, to) {
  return {
    x: to.x - from.x,
    y: to.y - from.y
  };
}
function splitPenSegment(points, segmentIndex, closed, t) {
  const controls = getPenSegmentControls(points, segmentIndex, closed);
  if (!controls) {
    return points;
  }
  const nextPoints = clonePenPoints(points);
  const start = nextPoints[segmentIndex];
  const end = nextPoints[controls.endIndex];
  const safeT = Math.min(0.95, Math.max(0.05, t));
  const p0 = controls.start;
  const cp1 = controls.cp1;
  const cp2 = controls.cp2;
  const p1 = controls.end;
  const p01 = lerpPoint(p0, cp1, safeT);
  const p12 = lerpPoint(cp1, cp2, safeT);
  const p23 = lerpPoint(cp2, p1, safeT);
  const p012 = lerpPoint(p01, p12, safeT);
  const p123 = lerpPoint(p12, p23, safeT);
  const middle = lerpPoint(p012, p123, safeT);
  const inserted = {
    x: middle.x,
    y: middle.y,
    kind: controls.hasCurve ? "smooth" : "corner",
    mirroring: controls.hasCurve ? "angle" : "none",
    in: controls.hasCurve ? pointDelta(middle, p012) : null,
    out: controls.hasCurve ? pointDelta(middle, p123) : null
  };
  if (controls.hasCurve) {
    start.out = pointDelta(p0, p01);
    end.in = pointDelta(p1, p23);
  }
  nextPoints.splice(segmentIndex + 1, 0, inserted);
  return nextPoints;
}

// src/editor/svgArc.ts
var MAX_ARC_SEGMENT_ANGLE = Math.PI / 2;
var EPSILON = 1e-9;
function parseSvgArcCommandData(data) {
  if (data.length < 7 || !data.every(Number.isFinite)) {
    return null;
  }
  return {
    rx: Math.abs(data[0]),
    ry: Math.abs(data[1]),
    xAxisRotation: data[2],
    largeArcFlag: Boolean(data[3]),
    sweepFlag: Boolean(data[4]),
    end: {
      x: data[5],
      y: data[6]
    }
  };
}
function svgArcToCubicBezierSegments(start, arc) {
  if (distance(start, arc.end) <= EPSILON || arc.rx <= EPSILON || arc.ry <= EPSILON) {
    return [];
  }
  const rotation = arc.xAxisRotation * Math.PI / 180;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const halfDelta = {
    x: (start.x - arc.end.x) / 2,
    y: (start.y - arc.end.y) / 2
  };
  const startPrime = {
    x: cosRotation * halfDelta.x + sinRotation * halfDelta.y,
    y: -sinRotation * halfDelta.x + cosRotation * halfDelta.y
  };
  let rx = arc.rx;
  let ry = arc.ry;
  const radiiScale = startPrime.x ** 2 / rx ** 2 + startPrime.y ** 2 / ry ** 2;
  if (radiiScale > 1) {
    const scale = Math.sqrt(radiiScale);
    rx *= scale;
    ry *= scale;
  }
  const rxSquared = rx ** 2;
  const rySquared = ry ** 2;
  const xPrimeSquared = startPrime.x ** 2;
  const yPrimeSquared = startPrime.y ** 2;
  const denominator = rxSquared * yPrimeSquared + rySquared * xPrimeSquared;
  if (denominator <= EPSILON) {
    return [];
  }
  const numerator = rxSquared * rySquared - rxSquared * yPrimeSquared - rySquared * xPrimeSquared;
  const coefficientSign = arc.largeArcFlag === arc.sweepFlag ? -1 : 1;
  const coefficient = coefficientSign * Math.sqrt(Math.max(0, numerator / denominator));
  const centerPrime = {
    x: coefficient * (rx * startPrime.y / ry),
    y: coefficient * -(ry * startPrime.x / rx)
  };
  const center = {
    x: cosRotation * centerPrime.x - sinRotation * centerPrime.y + (start.x + arc.end.x) / 2,
    y: sinRotation * centerPrime.x + cosRotation * centerPrime.y + (start.y + arc.end.y) / 2
  };
  const startVector = {
    x: (startPrime.x - centerPrime.x) / rx,
    y: (startPrime.y - centerPrime.y) / ry
  };
  const endVector = {
    x: (-startPrime.x - centerPrime.x) / rx,
    y: (-startPrime.y - centerPrime.y) / ry
  };
  const startAngle = vectorAngle({ x: 1, y: 0 }, startVector);
  let deltaAngle = vectorAngle(startVector, endVector);
  if (!arc.sweepFlag && deltaAngle > 0) {
    deltaAngle -= Math.PI * 2;
  }
  if (arc.sweepFlag && deltaAngle < 0) {
    deltaAngle += Math.PI * 2;
  }
  const segmentCount = Math.max(1, Math.ceil(Math.abs(deltaAngle) / MAX_ARC_SEGMENT_ANGLE));
  const segmentAngle = deltaAngle / segmentCount;
  const segments = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const angleStart = startAngle + segmentAngle * index;
    const angleEnd = angleStart + segmentAngle;
    const segment = arcSegmentToCubic(center, rx, ry, rotation, angleStart, angleEnd);
    segments.push(index === segmentCount - 1 ? { ...segment, end: { ...arc.end } } : segment);
  }
  return segments;
}
function arcSegmentToCubic(center, rx, ry, rotation, angleStart, angleEnd) {
  const delta = angleEnd - angleStart;
  const alpha = 4 / 3 * Math.tan(delta / 4);
  const start = {
    x: Math.cos(angleStart),
    y: Math.sin(angleStart)
  };
  const end = {
    x: Math.cos(angleEnd),
    y: Math.sin(angleEnd)
  };
  return {
    cp1: mapUnitArcPoint(
      {
        x: start.x - start.y * alpha,
        y: start.y + start.x * alpha
      },
      center,
      rx,
      ry,
      rotation
    ),
    cp2: mapUnitArcPoint(
      {
        x: end.x + end.y * alpha,
        y: end.y - end.x * alpha
      },
      center,
      rx,
      ry,
      rotation
    ),
    end: mapUnitArcPoint(end, center, rx, ry, rotation)
  };
}
function mapUnitArcPoint(point, center, rx, ry, rotation) {
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const scaled = {
    x: point.x * rx,
    y: point.y * ry
  };
  return {
    x: center.x + cosRotation * scaled.x - sinRotation * scaled.y,
    y: center.y + sinRotation * scaled.x + cosRotation * scaled.y
  };
}
function vectorAngle(from, to) {
  const denominator = Math.hypot(from.x, from.y) * Math.hypot(to.x, to.y);
  if (denominator <= EPSILON) {
    return 0;
  }
  const dot = (from.x * to.x + from.y * to.y) / denominator;
  const sign = from.x * to.y - from.y * to.x < 0 ? -1 : 1;
  return sign * Math.acos(Math.min(1, Math.max(-1, dot)));
}
function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

// src/editor/svgPathParser.ts
var SVG_PATH_COMMANDS = /* @__PURE__ */ new Set(["M", "m", "L", "l", "H", "h", "V", "v", "C", "c", "S", "s", "Q", "q", "T", "t", "A", "a", "Z", "z"]);
function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "	" || char === "\f";
}
function isDigit(char) {
  return char >= "0" && char <= "9";
}
function isCommand(char) {
  return SVG_PATH_COMMANDS.has(char);
}
function reflectPoint(point, origin) {
  return point ? {
    x: origin.x * 2 - point.x,
    y: origin.y * 2 - point.y
  } : { ...origin };
}
var SvgPathReader = class {
  constructor(source) {
    this.source = source;
  }
  index = 0;
  get done() {
    this.skipSeparators();
    return this.index >= this.source.length;
  }
  readCommand() {
    this.skipSeparators();
    const char = this.source[this.index];
    if (!char || !isCommand(char)) {
      return null;
    }
    this.index += 1;
    return char;
  }
  hasMoreCommandData() {
    this.skipSeparators();
    const char = this.source[this.index];
    return Boolean(char && !isCommand(char));
  }
  readNumber() {
    this.skipSeparators();
    const start = this.index;
    const first = this.source[this.index];
    if (first === "+" || first === "-") {
      this.index += 1;
    }
    let hasDigits = this.readDigits();
    if (this.source[this.index] === ".") {
      this.index += 1;
      hasDigits = this.readDigits() || hasDigits;
    }
    if (!hasDigits) {
      throw new Error(`Expected number at offset ${start}`);
    }
    if (this.source[this.index] === "e" || this.source[this.index] === "E") {
      const exponentStart = this.index;
      this.index += 1;
      const sign = this.source[this.index];
      if (sign === "+" || sign === "-") {
        this.index += 1;
      }
      if (!this.readDigits()) {
        throw new Error(`Expected exponent digits at offset ${exponentStart}`);
      }
    }
    const value = Number(this.source.slice(start, this.index));
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid number at offset ${start}`);
    }
    return value;
  }
  readFlag() {
    this.skipSeparators();
    const char = this.source[this.index];
    if (char !== "0" && char !== "1") {
      throw new Error(`Expected arc flag at offset ${this.index}`);
    }
    this.index += 1;
    return Number(char);
  }
  skipSeparators() {
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === "," || isWhitespace(char)) {
        this.index += 1;
      } else {
        break;
      }
    }
  }
  readDigits() {
    const start = this.index;
    while (isDigit(this.source[this.index] ?? "")) {
      this.index += 1;
    }
    return this.index > start;
  }
};
function makePoint(x, y, relative, current) {
  return relative ? {
    x: current.x + x,
    y: current.y + y
  } : { x, y };
}
function readPoint(reader, relative, current) {
  return makePoint(reader.readNumber(), reader.readNumber(), relative, current);
}
function parseSvgPathInstructions(pathData) {
  const reader = new SvgPathReader(pathData);
  const instructions = [];
  let command = null;
  let current = { x: 0, y: 0 };
  let contourStart = { x: 0, y: 0 };
  let previousCubicControl = null;
  let previousQuadraticControl = null;
  const clearSmoothControls = () => {
    previousCubicControl = null;
    previousQuadraticControl = null;
  };
  while (!reader.done) {
    command = reader.readCommand() ?? command;
    if (!command) {
      throw new Error("Path data must start with a command");
    }
    const activeCommand = command;
    const relative = activeCommand === activeCommand.toLowerCase();
    switch (activeCommand.toLowerCase()) {
      case "m": {
        const point = readPoint(reader, relative, current);
        current = point;
        contourStart = point;
        instructions.push({ action: "moveTo", data: [point.x, point.y] });
        clearSmoothControls();
        while (reader.hasMoreCommandData()) {
          const nextPoint = readPoint(reader, relative, current);
          current = nextPoint;
          instructions.push({ action: "lineTo", data: [nextPoint.x, nextPoint.y] });
        }
        command = relative ? "l" : "L";
        break;
      }
      case "l": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          const point = readPoint(reader, relative, current);
          current = point;
          instructions.push({ action: "lineTo", data: [point.x, point.y] });
          clearSmoothControls();
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "h": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          current = {
            x: relative ? current.x + reader.readNumber() : reader.readNumber(),
            y: current.y
          };
          instructions.push({ action: "lineTo", data: [current.x, current.y] });
          clearSmoothControls();
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "v": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          current = {
            x: current.x,
            y: relative ? current.y + reader.readNumber() : reader.readNumber()
          };
          instructions.push({ action: "lineTo", data: [current.x, current.y] });
          clearSmoothControls();
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "c": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          const cp1 = readPoint(reader, relative, current);
          const cp2 = readPoint(reader, relative, current);
          const end = readPoint(reader, relative, current);
          instructions.push({ action: "bezierCurveTo", data: [cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y] });
          current = end;
          previousCubicControl = cp2;
          previousQuadraticControl = null;
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "s": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          const cp1 = reflectPoint(previousCubicControl, current);
          const cp2 = readPoint(reader, relative, current);
          const end = readPoint(reader, relative, current);
          instructions.push({ action: "bezierCurveTo", data: [cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y] });
          current = end;
          previousCubicControl = cp2;
          previousQuadraticControl = null;
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "q": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          const control = readPoint(reader, relative, current);
          const end = readPoint(reader, relative, current);
          instructions.push({ action: "quadraticCurveTo", data: [control.x, control.y, end.x, end.y] });
          current = end;
          previousCubicControl = null;
          previousQuadraticControl = control;
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "t": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          const control = reflectPoint(previousQuadraticControl, current);
          const end = readPoint(reader, relative, current);
          instructions.push({ action: "quadraticCurveTo", data: [control.x, control.y, end.x, end.y] });
          current = end;
          previousCubicControl = null;
          previousQuadraticControl = control;
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "a": {
        let consumed = false;
        while (reader.hasMoreCommandData()) {
          const rx = reader.readNumber();
          const ry = reader.readNumber();
          const xAxisRotation = reader.readNumber();
          const largeArcFlag = reader.readFlag();
          const sweepFlag = reader.readFlag();
          const end = readPoint(reader, relative, current);
          instructions.push({
            action: "arcToSvg",
            data: [rx, ry, xAxisRotation, largeArcFlag, sweepFlag, end.x, end.y]
          });
          current = end;
          clearSmoothControls();
          consumed = true;
        }
        if (!consumed) {
          throw new Error(`Command ${activeCommand} is missing coordinates`);
        }
        break;
      }
      case "z":
        instructions.push({ action: "closePath", data: [] });
        current = contourStart;
        clearSmoothControls();
        command = null;
        break;
      default:
        throw new Error(`Unsupported SVG path command ${command}`);
    }
  }
  return instructions;
}

// src/editor/pathMorph.ts
var ADAPTIVE_SAMPLE_COUNT = 48;
var ADAPTIVE_LENGTH_SAMPLE_STEPS = 16;
var ADAPTIVE_PROGRESS_EPSILON = 1e-4;
var SPATIAL_MORPH_MIN_SAMPLE_COUNT = 48;
var SPATIAL_MORPH_MAX_SAMPLE_COUNT = 96;
var SPATIAL_MORPH_DENSE_SAMPLE_MULTIPLIER = 4;
var SPATIAL_MORPH_MIN_BOUND_SIZE = 48;
var RADIAL_MORPH_MIN_BOUND_SIZE = 24;
var RADIAL_MORPH_MIN_MAJOR_BOUND_SIZE = 80;
var RADIAL_MORPH_MIN_ASPECT_RATIO = 3;
var RADIAL_MORPH_SAMPLE_COUNT = 96;
var BBOX_MATCH_CLUSTER_DISTANCE = 0.045;
var BBOX_MATCH_MIN_BOUND_SIZE = 32;
var BBOX_MATCH_MAX_ASPECT_RATIO = 3;
var BBOX_MATCH_MIN_SAMPLE_COUNT = 96;
var BBOX_MATCH_SAMPLE_MULTIPLIER = 16;
var LENGTH_SAMPLED_MORPH_PREFERRED_MIN_BOUND_SIZE = 32;
var LENGTH_SAMPLED_MORPH_PREFERRED_MAX_ASPECT_RATIO = 3;
var LENGTH_SAMPLED_MORPH_MIN_SAMPLE_COUNT = 24;
var LENGTH_SAMPLED_MORPH_MAX_SAMPLE_COUNT = 64;
var LENGTH_SAMPLED_MORPH_POINT_MULTIPLIER = 2;
var MORPH_SCORE_SAMPLE_PROGRESS = [0.12, 0.25, 0.5, 0.75];
var MORPH_SCORE_FLATTEN_STEPS = 5;
var MORPH_SCORE_INTERSECTION_PENALTY = 1e4;
var MORPH_SCORE_AREA_COLLAPSE_PENALTY = 6e3;
var MORPH_SCORE_POINT_COUNT_PENALTY = 0.15;
var MORPH_STABLE_MIN_AREA_RATIO = 0.45;
var STABLE_CLOSED_PATH_MORPH_CANDIDATE_ORDER = [
  "balanced",
  "length",
  "radial",
  "bbox",
  "spatial",
  "max-anchor"
];
var CLOSED_PATH_MORPH_CANDIDATE_CACHE_LIMIT = 200;
var SVG_NS = "http://www.w3.org/2000/svg";
var closedPathMorphCandidateCache = /* @__PURE__ */ new Map();
var closedPathMorphPreparedCandidateCache = /* @__PURE__ */ new Map();
function createPathIssue(code, message, fallback) {
  return fallback ? { code, message, fallback } : { code, message };
}
function formatPathError(error) {
  return error instanceof Error && error.message ? error.message : "unknown error";
}
function getPathOperationValue(result) {
  return result.ok ? result.value : result.fallback ?? null;
}
function getPathOperationIssues(result) {
  return result.ok ? result.warnings ?? [] : [result.reason];
}
function offset(from, to) {
  return {
    x: to.x - from.x,
    y: to.y - from.y
  };
}
function lerp(left, right, progress) {
  return left + (right - left) * progress;
}
function lerpPoint2(left, right, progress) {
  return {
    x: lerp(left.x, right.x, progress),
    y: lerp(left.y, right.y, progress)
  };
}
function lerpHandle(left, right, progress) {
  if (!left && !right) {
    return null;
  }
  return lerpPoint2(left ?? { x: 0, y: 0 }, right ?? { x: 0, y: 0 }, progress);
}
function distance2(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}
function circularProgressDistance(left, right) {
  const delta = Math.abs(left - right);
  return Math.min(delta, 1 - delta);
}
function cloneAnimationPath(path) {
  return {
    closed: path.closed,
    points: clonePenPoints(path.points)
  };
}
function pointsAreClose(left, right) {
  return distance2(left, right) <= ADAPTIVE_PROGRESS_EPSILON;
}
function normalizeClosedPathEndpoint(path) {
  if (!path.closed || path.points.length <= 2) {
    return cloneAnimationPath(path);
  }
  const first = path.points[0];
  const last = path.points[path.points.length - 1];
  if (!first || !last || !pointsAreClose(first, last)) {
    return cloneAnimationPath(path);
  }
  const points = clonePenPoints(path.points.slice(0, -1));
  const normalizedFirst = points[0];
  if (normalizedFirst && last.in) {
    normalizedFirst.in = { ...last.in };
  }
  return {
    closed: path.closed,
    points
  };
}
function getPathSignedArea(path) {
  let area = 0;
  path.points.forEach((point, index) => {
    const nextPoint = path.points[(index + 1) % path.points.length];
    if (!nextPoint) {
      return;
    }
    area += point.x * nextPoint.y - nextPoint.x * point.y;
  });
  return area / 2;
}
function getPathWindingSign(path) {
  const area = getPathSignedArea(path);
  if (Math.abs(area) <= ADAPTIVE_PROGRESS_EPSILON) {
    return 0;
  }
  return area > 0 ? 1 : -1;
}
function reversePathWinding(path) {
  return {
    closed: path.closed,
    points: clonePenPoints(path.points).reverse().map((point) => ({
      ...point,
      in: point.out ? { ...point.out } : point.out,
      out: point.in ? { ...point.in } : point.in
    }))
  };
}
function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
}
function scaleCommandData(data, scale) {
  return data.map((value) => value * scale);
}
function serializeCommand(command, data) {
  return `${command} ${data.map(formatNumber).join(" ")}`;
}
function normalizePathData(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "d" in value) {
    const pathData = value.d;
    return typeof pathData === "string" ? pathData.trim() : "";
  }
  return "";
}
function scaleSvgPathDataResult(pathData, scale) {
  const source = normalizePathData(pathData);
  if (!source) {
    return { ok: true, value: "" };
  }
  if (!Number.isFinite(scale)) {
    return {
      ok: false,
      reason: createPathIssue("path-scale-invalid-scale", "Path scale failed because scale is not finite", "source-path"),
      fallback: source
    };
  }
  try {
    const commands = [];
    for (const instruction of parseSvgPathInstructions(source)) {
      if (instruction.action === "moveTo") {
        commands.push(serializeCommand("M", scaleCommandData(instruction.data, scale)));
      } else if (instruction.action === "lineTo") {
        commands.push(serializeCommand("L", scaleCommandData(instruction.data, scale)));
      } else if (instruction.action === "bezierCurveTo") {
        commands.push(serializeCommand("C", scaleCommandData(instruction.data, scale)));
      } else if (instruction.action === "quadraticCurveTo") {
        commands.push(serializeCommand("Q", scaleCommandData(instruction.data, scale)));
      } else if (instruction.action === "arcToSvg") {
        const data = [...instruction.data];
        data[0] *= scale;
        data[1] *= scale;
        data[5] *= scale;
        data[6] *= scale;
        commands.push(serializeCommand("A", data));
      } else if (instruction.action === "closePath") {
        commands.push("Z");
      } else {
        return {
          ok: false,
          reason: createPathIssue(
            "path-scale-unsupported-command",
            `Path scale does not support command ${instruction.action}`,
            "source-path"
          ),
          fallback: source
        };
      }
    }
    return { ok: true, value: commands.join(" ") };
  } catch (error) {
    return {
      ok: false,
      reason: createPathIssue(
        "path-scale-parse-failed",
        `Path scale failed to parse source path: ${formatPathError(error)}`,
        "source-path"
      ),
      fallback: source
    };
  }
}
function scaleSvgPathData(pathData, scale) {
  return getPathOperationValue(scaleSvgPathDataResult(pathData, scale)) ?? "";
}
function translateSvgPathDataResult(pathData, delta) {
  const source = normalizePathData(pathData);
  if (!source) {
    return { ok: true, value: "" };
  }
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return {
      ok: false,
      reason: createPathIssue(
        "path-translate-invalid-delta",
        "Path translate failed because delta is not finite",
        "source-path"
      ),
      fallback: source
    };
  }
  try {
    const commands = [];
    for (const instruction of parseSvgPathInstructions(source)) {
      if (instruction.action === "moveTo") {
        commands.push(serializeCommand("M", [
          instruction.data[0] + delta.x,
          instruction.data[1] + delta.y
        ]));
      } else if (instruction.action === "lineTo") {
        commands.push(serializeCommand("L", [
          instruction.data[0] + delta.x,
          instruction.data[1] + delta.y
        ]));
      } else if (instruction.action === "bezierCurveTo") {
        commands.push(serializeCommand("C", [
          instruction.data[0] + delta.x,
          instruction.data[1] + delta.y,
          instruction.data[2] + delta.x,
          instruction.data[3] + delta.y,
          instruction.data[4] + delta.x,
          instruction.data[5] + delta.y
        ]));
      } else if (instruction.action === "quadraticCurveTo") {
        commands.push(serializeCommand("Q", [
          instruction.data[0] + delta.x,
          instruction.data[1] + delta.y,
          instruction.data[2] + delta.x,
          instruction.data[3] + delta.y
        ]));
      } else if (instruction.action === "arcToSvg") {
        const data = [...instruction.data];
        data[5] += delta.x;
        data[6] += delta.y;
        commands.push(serializeCommand("A", data));
      } else if (instruction.action === "closePath") {
        commands.push("Z");
      } else {
        return {
          ok: false,
          reason: createPathIssue(
            "path-translate-unsupported-command",
            `Path translate does not support command ${instruction.action}`,
            "source-path"
          ),
          fallback: source
        };
      }
    }
    return { ok: true, value: commands.join(" ") };
  } catch (error) {
    return {
      ok: false,
      reason: createPathIssue(
        "path-translate-parse-failed",
        `Path translate failed to parse source path: ${formatPathError(error)}`,
        "source-path"
      ),
      fallback: source
    };
  }
}
function translateSvgPathData(pathData, delta) {
  return getPathOperationValue(translateSvgPathDataResult(pathData, delta)) ?? "";
}
function penPathToSvgPathData(points, closed) {
  const firstPoint = points[0];
  if (!firstPoint) {
    return "";
  }
  const commands = [`M ${formatNumber(firstPoint.x)} ${formatNumber(firstPoint.y)}`];
  for (let segmentIndex = 0; segmentIndex < getPenSegmentCount(points, closed); segmentIndex += 1) {
    const segment = getPenSegmentControls(points, segmentIndex, closed);
    if (!segment) {
      continue;
    }
    if (segment.hasCurve) {
      commands.push(
        serializeCommand("C", [
          segment.cp1.x,
          segment.cp1.y,
          segment.cp2.x,
          segment.cp2.y,
          segment.end.x,
          segment.end.y
        ])
      );
    } else {
      commands.push(serializeCommand("L", [segment.end.x, segment.end.y]));
    }
  }
  if (closed && points.length > 2) {
    commands.push("Z");
  }
  return commands.join(" ");
}
function closeCurrentContour(contours, current) {
  if (current && current.points.length >= 2) {
    contours.push(current);
  }
}
function appendCubicBezierSegment(active, cp1, cp2, end) {
  const start = active.points[active.points.length - 1];
  if (start) {
    start.out = offset(start, cp1);
    start.kind = "smooth";
    start.mirroring = "angle";
  }
  active.points.push({
    ...end,
    in: offset(end, cp2),
    out: null,
    kind: "smooth",
    mirroring: "angle"
  });
}
function parseSvgPathDataResult(pathData) {
  const source = normalizePathData(pathData);
  if (!source) {
    return {
      ok: false,
      reason: createPathIssue("path-parse-empty", "Path parse failed because source path is empty")
    };
  }
  try {
    const contours = [];
    let current = null;
    const warnings = [];
    const ensureCurrent = (point) => {
      if (!current) {
        current = {
          points: [{ ...point, kind: "corner", mirroring: "none" }],
          closed: false
        };
      }
      return current;
    };
    parseSvgPathInstructions(source).forEach((instruction) => {
      if (instruction.action === "moveTo") {
        closeCurrentContour(contours, current);
        current = {
          points: [{ x: instruction.data[0], y: instruction.data[1], kind: "corner", mirroring: "none" }],
          closed: false
        };
        return;
      }
      if (instruction.action === "lineTo") {
        ensureCurrent({ x: instruction.data[0], y: instruction.data[1] }).points.push({
          x: instruction.data[0],
          y: instruction.data[1],
          kind: "corner",
          mirroring: "none"
        });
        return;
      }
      if (instruction.action === "bezierCurveTo") {
        const active = ensureCurrent({ x: instruction.data[4], y: instruction.data[5] });
        const end = { x: instruction.data[4], y: instruction.data[5] };
        appendCubicBezierSegment(
          active,
          { x: instruction.data[0], y: instruction.data[1] },
          { x: instruction.data[2], y: instruction.data[3] },
          end
        );
        return;
      }
      if (instruction.action === "quadraticCurveTo") {
        const active = ensureCurrent({ x: instruction.data[2], y: instruction.data[3] });
        const start = active.points[active.points.length - 1];
        const control = { x: instruction.data[0], y: instruction.data[1] };
        const end = { x: instruction.data[2], y: instruction.data[3] };
        if (start) {
          start.out = offset(start, {
            x: start.x + 2 / 3 * (control.x - start.x),
            y: start.y + 2 / 3 * (control.y - start.y)
          });
          start.kind = "smooth";
          start.mirroring = "angle";
        }
        active.points.push({
          ...end,
          in: offset(end, {
            x: end.x + 2 / 3 * (control.x - end.x),
            y: end.y + 2 / 3 * (control.y - end.y)
          }),
          out: null,
          kind: "smooth",
          mirroring: "angle"
        });
        return;
      }
      if (instruction.action === "arcToSvg") {
        const arcCommand = parseSvgArcCommandData(instruction.data);
        if (!arcCommand) {
          warnings.push(createPathIssue(
            "path-parse-invalid-arc",
            "Path parse skipped an invalid SVG arc command",
            "skip-command"
          ));
          return;
        }
        const active = ensureCurrent(arcCommand.end);
        const start = active.points[active.points.length - 1];
        const segments = start ? svgArcToCubicBezierSegments(start, arcCommand) : [];
        if (segments.length === 0) {
          active.points.push({ ...arcCommand.end, kind: "corner", mirroring: "none" });
          return;
        }
        segments.forEach((segment) => appendCubicBezierSegment(active, segment.cp1, segment.cp2, segment.end));
        return;
      }
      if (instruction.action === "closePath" && current) {
        current.closed = true;
        return;
      }
      warnings.push(createPathIssue(
        "path-parse-unsupported-command",
        `Path parse skipped unsupported command ${instruction.action}`,
        "skip-command"
      ));
    });
    closeCurrentContour(contours, current);
    if (contours.length > 1) {
      warnings.push(createPathIssue(
        "path-parse-multiple-contours",
        "Path parse used the first contour because animation paths support one contour",
        "first-contour"
      ));
    }
    const path = contours[0];
    if (!path) {
      return {
        ok: false,
        reason: createPathIssue("path-parse-empty-result", "Path parse produced no drawable contour")
      };
    }
    return warnings.length > 0 ? { ok: true, value: path, warnings } : { ok: true, value: path };
  } catch (error) {
    return {
      ok: false,
      reason: createPathIssue("path-parse-failed", `Path parse failed: ${formatPathError(error)}`)
    };
  }
}
function parseSvgPathData(pathData) {
  return getPathOperationValue(parseSvgPathDataResult(pathData));
}
function pathIsClosed(pathData) {
  return /z\s*$/i.test(pathData.trim());
}
function sampleSvgPathDataResult(pathData, sampleCount = ADAPTIVE_SAMPLE_COUNT) {
  if (typeof document === "undefined") {
    return {
      ok: false,
      reason: createPathIssue("path-sample-dom-unavailable", "Path sampling requires DOM path APIs")
    };
  }
  try {
    const pathElement = document.createElementNS(SVG_NS, "path");
    pathElement.setAttribute("d", pathData);
    const totalLength = pathElement.getTotalLength();
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      return {
        ok: false,
        reason: createPathIssue("path-sample-invalid-length", "Path sampling failed because path length is invalid")
      };
    }
    const points = [];
    const closed = pathIsClosed(pathData);
    const denominator = closed ? sampleCount : sampleCount - 1;
    for (let index = 0; index < sampleCount; index += 1) {
      const point = pathElement.getPointAtLength(totalLength * index / Math.max(1, denominator));
      points.push({
        x: point.x,
        y: point.y,
        kind: "corner",
        mirroring: "none"
      });
    }
    return { ok: true, value: { points, closed } };
  } catch (error) {
    return {
      ok: false,
      reason: createPathIssue("path-sample-failed", `Path sampling failed: ${formatPathError(error)}`)
    };
  }
}
function measurePenSegmentLength(points, segmentIndex, closed) {
  const segment = getPenSegmentControls(points, segmentIndex, closed);
  if (!segment) {
    return 0;
  }
  if (!segment.hasCurve) {
    return distance2(segment.start, segment.end);
  }
  let length = 0;
  let previous = segment.start;
  for (let step = 1; step <= ADAPTIVE_LENGTH_SAMPLE_STEPS; step += 1) {
    const point = cubicPoint(
      segment.start,
      segment.cp1,
      segment.cp2,
      segment.end,
      step / ADAPTIVE_LENGTH_SAMPLE_STEPS
    );
    length += distance2(previous, point);
    previous = point;
  }
  return length;
}
function getPathSegmentLengths(path) {
  return Array.from({ length: getPenSegmentCount(path.points, path.closed) }, (_, segmentIndex) => measurePenSegmentLength(path.points, segmentIndex, path.closed));
}
function getPathBounds(path) {
  const xs = path.points.map((point) => point.x);
  const ys = path.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}
function normalizePointToBounds(point, bounds) {
  return {
    x: bounds.width <= ADAPTIVE_PROGRESS_EPSILON ? 0.5 : (point.x - bounds.minX) / bounds.width,
    y: bounds.height <= ADAPTIVE_PROGRESS_EPSILON ? 0.5 : (point.y - bounds.minY) / bounds.height
  };
}
function getBoundsAspectRatio(bounds) {
  const minSize = Math.min(bounds.width, bounds.height);
  const maxSize = Math.max(bounds.width, bounds.height);
  return minSize <= ADAPTIVE_PROGRESS_EPSILON ? Number.POSITIVE_INFINITY : maxSize / minSize;
}
function getPathBoundsCenter(path) {
  const bounds = getPathBounds(path);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}
function getPointAtPathProgress(path, progress) {
  const segmentLengths = getPathSegmentLengths(path);
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(totalLength) || totalLength <= ADAPTIVE_PROGRESS_EPSILON) {
    return path.points[0] ?? { x: 0, y: 0 };
  }
  const targetLength = normalizeProgress(progress, path.closed) * totalLength;
  let offsetLength = 0;
  for (let segmentIndex = 0; segmentIndex < segmentLengths.length; segmentIndex += 1) {
    const segmentLength = segmentLengths[segmentIndex] ?? 0;
    const nextOffset = offsetLength + segmentLength;
    if (targetLength <= nextOffset + ADAPTIVE_PROGRESS_EPSILON) {
      const segment = getPenSegmentControls(path.points, segmentIndex, path.closed);
      if (!segment || segmentLength <= ADAPTIVE_PROGRESS_EPSILON) {
        return segment?.start ?? path.points[segmentIndex] ?? { x: 0, y: 0 };
      }
      return cubicPoint(
        segment.start,
        segment.cp1,
        segment.cp2,
        segment.end,
        Math.min(1, Math.max(0, (targetLength - offsetLength) / segmentLength))
      );
    }
    offsetLength = nextOffset;
  }
  return path.closed ? path.points[0] ?? { x: 0, y: 0 } : path.points[path.points.length - 1] ?? { x: 0, y: 0 };
}
function samplePathByLength(path, sampleCount) {
  const denominator = path.closed ? sampleCount : Math.max(1, sampleCount - 1);
  return Array.from({ length: sampleCount }, (_, index) => getPointAtPathProgress(path, index / Math.max(1, denominator)));
}
function getClockwiseAngleProgress(point, center) {
  const angle = Math.atan2(point.y - center.y, point.x - center.x) + Math.PI / 2;
  const progress = angle / (Math.PI * 2);
  return normalizeProgress(progress, true);
}
function createSmoothClosedSamplePoints(points) {
  return points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length] ?? point;
    const next = points[(index + 1) % points.length] ?? point;
    const handle = {
      x: (next.x - previous.x) / 6,
      y: (next.y - previous.y) / 6
    };
    return {
      ...point,
      in: {
        x: -handle.x,
        y: -handle.y
      },
      out: handle,
      kind: "smooth",
      mirroring: "angle"
    };
  });
}
function createCornerClosedSamplePoints(points) {
  return points.map((point) => ({
    ...point,
    in: null,
    out: null,
    kind: "corner",
    mirroring: "none"
  }));
}
function getSpatialMorphSampleCount(fromPath, toPath) {
  return Math.min(
    SPATIAL_MORPH_MAX_SAMPLE_COUNT,
    Math.max(
      SPATIAL_MORPH_MIN_SAMPLE_COUNT,
      Math.max(fromPath.points.length, toPath.points.length) * SPATIAL_MORPH_DENSE_SAMPLE_MULTIPLIER
    )
  );
}
function sampleClosedPathByAngle(path, sampleCount, pointMode = "smooth") {
  const center = getPathBoundsCenter(path);
  const denseSamples = samplePathByLength(
    path,
    Math.max(sampleCount * SPATIAL_MORPH_DENSE_SAMPLE_MULTIPLIER, path.points.length * 12)
  );
  const angleSamples = denseSamples.map((point) => ({
    point,
    progress: getClockwiseAngleProgress(point, center)
  }));
  const sampledPoints = Array.from({ length: sampleCount }, (_, index) => {
    const targetProgress = index / sampleCount;
    let best = angleSamples[0];
    angleSamples.forEach((candidate) => {
      const candidateDistance = circularProgressDistance(candidate.progress, targetProgress);
      const bestDistance = best ? circularProgressDistance(best.progress, targetProgress) : Number.POSITIVE_INFINITY;
      if (candidateDistance < bestDistance) {
        best = candidate;
      }
    });
    return best?.point ?? path.points[0] ?? { x: 0, y: 0 };
  });
  return {
    closed: true,
    points: pointMode === "corner" ? createCornerClosedSamplePoints(sampledPoints) : createSmoothClosedSamplePoints(sampledPoints)
  };
}
function prepareSpatialClosedPaths(fromPath, toPath, minBoundSize = SPATIAL_MORPH_MIN_BOUND_SIZE) {
  if (!fromPath.closed || !toPath.closed || fromPath.points.length < 2 || toPath.points.length < 2) {
    return null;
  }
  const fromBounds = getPathBounds(fromPath);
  const toBounds = getPathBounds(toPath);
  if (Math.min(fromBounds.width, fromBounds.height) < minBoundSize || Math.min(toBounds.width, toBounds.height) < minBoundSize) {
    return null;
  }
  const sampleCount = getSpatialMorphSampleCount(fromPath, toPath);
  return {
    fromPath: sampleClosedPathByAngle(normalizeClosedPathEndpoint(fromPath), sampleCount),
    toPath: sampleClosedPathByAngle(normalizeClosedPathEndpoint(toPath), sampleCount)
  };
}
function shouldPreferRadialSampledClosedPaths(fromPath, toPath) {
  const fromBounds = getPathBounds(fromPath);
  const toBounds = getPathBounds(toPath);
  const fromMaxSize = Math.max(fromBounds.width, fromBounds.height);
  const toMaxSize = Math.max(toBounds.width, toBounds.height);
  const fromMinSize = Math.min(fromBounds.width, fromBounds.height);
  const toMinSize = Math.min(toBounds.width, toBounds.height);
  return fromMinSize >= RADIAL_MORPH_MIN_BOUND_SIZE && toMinSize >= RADIAL_MORPH_MIN_BOUND_SIZE && fromMaxSize >= RADIAL_MORPH_MIN_MAJOR_BOUND_SIZE && toMaxSize >= RADIAL_MORPH_MIN_MAJOR_BOUND_SIZE && (getBoundsAspectRatio(fromBounds) >= RADIAL_MORPH_MIN_ASPECT_RATIO || getBoundsAspectRatio(toBounds) >= RADIAL_MORPH_MIN_ASPECT_RATIO);
}
function prepareRadialSampledClosedPaths(fromPath, toPath) {
  if (!fromPath.closed || !toPath.closed || fromPath.points.length < 2 || toPath.points.length < 2) {
    return null;
  }
  const fromBounds = getPathBounds(fromPath);
  const toBounds = getPathBounds(toPath);
  if (Math.min(fromBounds.width, fromBounds.height) < RADIAL_MORPH_MIN_BOUND_SIZE || Math.min(toBounds.width, toBounds.height) < RADIAL_MORPH_MIN_BOUND_SIZE) {
    return null;
  }
  return {
    fromPath: sampleClosedPathByAngle(normalizeClosedPathEndpoint(fromPath), RADIAL_MORPH_SAMPLE_COUNT, "corner"),
    toPath: sampleClosedPathByAngle(normalizeClosedPathEndpoint(toPath), RADIAL_MORPH_SAMPLE_COUNT, "corner")
  };
}
function getLengthSampledMorphSampleCount(fromPath, toPath) {
  return Math.min(
    LENGTH_SAMPLED_MORPH_MAX_SAMPLE_COUNT,
    Math.max(
      LENGTH_SAMPLED_MORPH_MIN_SAMPLE_COUNT,
      Math.max(fromPath.points.length, toPath.points.length) * LENGTH_SAMPLED_MORPH_POINT_MULTIPLIER
    )
  );
}
function sampleClosedPathByLength(path, sampleCount) {
  return {
    closed: true,
    points: createSmoothClosedSamplePoints(samplePathByLength(path, sampleCount))
  };
}
function getBBoxAnchorCandidates(path, source) {
  const bounds = getPathBounds(path);
  const progresses = getPathAnchorProgresses(path);
  return path.points.map((point, index) => ({
    source,
    point: normalizePointToBounds(point, bounds),
    progress: progresses[index] ?? 0
  }));
}
function getNormalizedAngleProgress(point) {
  return getClockwiseAngleProgress(point, { x: 0.5, y: 0.5 });
}
function getNormalizedRadius(point) {
  return distance2(point, { x: 0.5, y: 0.5 });
}
function compareBBoxClusterOrder(left, right) {
  const angleDelta = getNormalizedAngleProgress(left.point) - getNormalizedAngleProgress(right.point);
  if (Math.abs(angleDelta) > ADAPTIVE_PROGRESS_EPSILON) {
    return angleDelta;
  }
  return getNormalizedRadius(left.point) - getNormalizedRadius(right.point);
}
function addBBoxCandidateToCluster(cluster, candidate) {
  const nextCount = cluster.count + 1;
  cluster.point = {
    x: (cluster.point.x * cluster.count + candidate.point.x) / nextCount,
    y: (cluster.point.y * cluster.count + candidate.point.y) / nextCount
  };
  cluster.count = nextCount;
  if (candidate.source === "from") {
    cluster.fromProgresses.push(candidate.progress);
  } else {
    cluster.toProgresses.push(candidate.progress);
  }
}
function createBBoxAnchorClusters(fromPath, toPath) {
  const candidates = [
    ...getBBoxAnchorCandidates(fromPath, "from"),
    ...getBBoxAnchorCandidates(toPath, "to")
  ].sort((left, right) => {
    const angleDelta = getNormalizedAngleProgress(left.point) - getNormalizedAngleProgress(right.point);
    if (Math.abs(angleDelta) > ADAPTIVE_PROGRESS_EPSILON) {
      return angleDelta;
    }
    return getNormalizedRadius(left.point) - getNormalizedRadius(right.point);
  });
  const clusters = [];
  candidates.forEach((candidate) => {
    let bestCluster = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    clusters.forEach((cluster) => {
      const candidateDistance = distance2(cluster.point, candidate.point);
      if (candidateDistance < bestDistance) {
        bestCluster = cluster;
        bestDistance = candidateDistance;
      }
    });
    if (bestCluster && bestDistance <= BBOX_MATCH_CLUSTER_DISTANCE) {
      addBBoxCandidateToCluster(bestCluster, candidate);
      return;
    }
    clusters.push({
      point: { ...candidate.point },
      count: 1,
      fromProgresses: candidate.source === "from" ? [candidate.progress] : [],
      toProgresses: candidate.source === "to" ? [candidate.progress] : []
    });
  });
  return clusters.sort(compareBBoxClusterOrder);
}
function averageClosedProgress(progresses) {
  if (progresses.length === 0) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  progresses.forEach((progress) => {
    const angle = normalizeProgress(progress, true) * Math.PI * 2;
    sumX += Math.cos(angle);
    sumY += Math.sin(angle);
  });
  if (Math.hypot(sumX, sumY) <= ADAPTIVE_PROGRESS_EPSILON) {
    return normalizeProgress(progresses[0] ?? 0, true);
  }
  return normalizeProgress(Math.atan2(sumY, sumX) / (Math.PI * 2), true);
}
function findClosestPathProgressToNormalizedPoint(path, target) {
  const bounds = getPathBounds(path);
  const sampleCount = Math.max(BBOX_MATCH_MIN_SAMPLE_COUNT, path.points.length * BBOX_MATCH_SAMPLE_MULTIPLIER);
  let bestProgress = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / sampleCount;
    const point = normalizePointToBounds(getPointAtPathProgress(path, progress), bounds);
    const pointDistance = distance2(point, target);
    if (pointDistance < bestDistance) {
      bestProgress = progress;
      bestDistance = pointDistance;
    }
  }
  return bestProgress;
}
function resolveBBoxClusterProgress(path, cluster, source) {
  const sourceProgresses = source === "from" ? cluster.fromProgresses : cluster.toProgresses;
  const averageProgress = averageClosedProgress(sourceProgresses);
  return averageProgress ?? findClosestPathProgressToNormalizedPoint(path, cluster.point);
}
function findClosestAnchorIndexAtProgress(path, progress) {
  const anchorProgresses = getPathAnchorProgresses(path);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  anchorProgresses.forEach((anchorProgress, index) => {
    const anchorDistance = progressDistance(anchorProgress, progress, path.closed);
    if (anchorDistance < bestDistance) {
      bestIndex = index;
      bestDistance = anchorDistance;
    }
  });
  return bestIndex;
}
function createPathAtProgresses(path, progresses) {
  const pathWithAnchors = addPathAnchorsAtProgresses(path, progresses);
  return {
    closed: path.closed,
    points: progresses.map((progress) => {
      const point = pathWithAnchors.points[findClosestAnchorIndexAtProgress(pathWithAnchors, progress)];
      return point ? clonePenPoint(point) : { ...getPointAtPathProgress(path, progress), kind: "corner", mirroring: "none" };
    })
  };
}
function normalizeClosedPathForBBoxMatching(path) {
  const normalizedPath = normalizeClosedPathEndpoint(path);
  const winding = getPathWindingSign(normalizedPath);
  return winding < 0 ? reversePathWinding(normalizedPath) : normalizedPath;
}
function prepareBBoxMatchedClosedPaths(fromPath, toPath) {
  if (!fromPath.closed || !toPath.closed || fromPath.points.length < 2 || toPath.points.length < 2) {
    return null;
  }
  const normalizedFromPath = normalizeClosedPathForBBoxMatching(fromPath);
  const normalizedToPath = normalizeClosedPathForBBoxMatching(toPath);
  const fromBounds = getPathBounds(normalizedFromPath);
  const toBounds = getPathBounds(normalizedToPath);
  if (Math.min(fromBounds.width, fromBounds.height) < BBOX_MATCH_MIN_BOUND_SIZE || Math.min(toBounds.width, toBounds.height) < BBOX_MATCH_MIN_BOUND_SIZE || getBoundsAspectRatio(fromBounds) > BBOX_MATCH_MAX_ASPECT_RATIO || getBoundsAspectRatio(toBounds) > BBOX_MATCH_MAX_ASPECT_RATIO) {
    return null;
  }
  const clusters = createBBoxAnchorClusters(normalizedFromPath, normalizedToPath);
  if (clusters.length < 2) {
    return null;
  }
  const pairs = clusters.map((cluster) => ({
    fromProgress: resolveBBoxClusterProgress(normalizedFromPath, cluster, "from"),
    toProgress: resolveBBoxClusterProgress(normalizedToPath, cluster, "to")
  })).sort((left, right) => left.fromProgress - right.fromProgress);
  return {
    fromPath: createPathAtProgresses(
      normalizedFromPath,
      pairs.map((pair) => pair.fromProgress)
    ),
    toPath: createPathAtProgresses(
      normalizedToPath,
      pairs.map((pair) => pair.toProgress)
    )
  };
}
function prepareMaxAnchorMatchedClosedPaths(fromPath, toPath) {
  if (!fromPath.closed || !toPath.closed || fromPath.points.length < 2 || toPath.points.length < 2) {
    return null;
  }
  const normalizedFromPath = normalizeClosedPathEndpoint(fromPath);
  const normalizedToPath = normalizeClosedPathEndpoint(toPath);
  const fromWinding = getPathWindingSign(normalizedFromPath);
  const toWinding = getPathWindingSign(normalizedToPath);
  const windingAlignedToPath = fromWinding !== 0 && toWinding !== 0 && fromWinding !== toWinding ? reversePathWinding(normalizedToPath) : normalizedToPath;
  const alignedFromPath = rotateClosedPathStart(normalizedFromPath);
  const alignedToPath = rotateClosedPathStart(windingAlignedToPath);
  const referencePath = alignedFromPath.points.length >= alignedToPath.points.length ? alignedFromPath : alignedToPath;
  const targetProgresses = getPathAnchorProgresses(referencePath);
  if (targetProgresses.length < 2) {
    return null;
  }
  return {
    fromPath: createPathAtProgresses(alignedFromPath, targetProgresses),
    toPath: createPathAtProgresses(alignedToPath, targetProgresses)
  };
}
function prepareLengthSampledClosedPaths(fromPath, toPath) {
  if (!fromPath.closed || !toPath.closed || fromPath.points.length < 2 || toPath.points.length < 2) {
    return null;
  }
  const normalizedFromPath = normalizeClosedPathEndpoint(fromPath);
  const normalizedToPath = normalizeClosedPathEndpoint(toPath);
  const fromWinding = getPathWindingSign(normalizedFromPath);
  const toWinding = getPathWindingSign(normalizedToPath);
  const windingAlignedToPath = fromWinding !== 0 && toWinding !== 0 && fromWinding !== toWinding ? reversePathWinding(normalizedToPath) : normalizedToPath;
  const alignedFromPath = rotateClosedPathStart(normalizedFromPath);
  const alignedToPath = rotateClosedPathStart(windingAlignedToPath);
  const sampleCount = getLengthSampledMorphSampleCount(alignedFromPath, alignedToPath);
  return {
    fromPath: sampleClosedPathByLength(alignedFromPath, sampleCount),
    toPath: sampleClosedPathByLength(alignedToPath, sampleCount)
  };
}
function shouldPreferLengthSampledClosedPaths(fromPath, toPath) {
  const fromBounds = getPathBounds(fromPath);
  const toBounds = getPathBounds(toPath);
  return Math.min(fromBounds.width, fromBounds.height) < LENGTH_SAMPLED_MORPH_PREFERRED_MIN_BOUND_SIZE || Math.min(toBounds.width, toBounds.height) < LENGTH_SAMPLED_MORPH_PREFERRED_MIN_BOUND_SIZE || getBoundsAspectRatio(fromBounds) > LENGTH_SAMPLED_MORPH_PREFERRED_MAX_ASPECT_RATIO || getBoundsAspectRatio(toBounds) > LENGTH_SAMPLED_MORPH_PREFERRED_MAX_ASPECT_RATIO;
}
function createClosedPathMorphCandidate(name, paths, priority) {
  if (!paths || paths.fromPath.points.length !== paths.toPath.points.length) {
    return null;
  }
  return {
    name,
    fromPath: paths.fromPath,
    toPath: paths.toPath,
    priority
  };
}
function createClosedPathMorphCandidates(fromPath, toPath) {
  const preferLength = shouldPreferLengthSampledClosedPaths(fromPath, toPath);
  return [
    createClosedPathMorphCandidate("max-anchor", prepareMaxAnchorMatchedClosedPaths(fromPath, toPath), 0),
    createClosedPathMorphCandidate("balanced", prepareBalancedPaths(fromPath, toPath), 2),
    createClosedPathMorphCandidate("bbox", prepareBBoxMatchedClosedPaths(fromPath, toPath), 4),
    shouldPreferRadialSampledClosedPaths(fromPath, toPath) ? createClosedPathMorphCandidate("radial", prepareRadialSampledClosedPaths(fromPath, toPath), 8) : null,
    createClosedPathMorphCandidate("spatial", prepareSpatialClosedPaths(fromPath, toPath), 10),
    createClosedPathMorphCandidate("length", prepareLengthSampledClosedPaths(fromPath, toPath), preferLength ? 6 : 12)
  ].filter((candidate) => Boolean(candidate));
}
function formatPathMorphSignatureNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "";
}
function getPathMorphSignature(path) {
  return [
    path.closed ? "1" : "0",
    path.points.length,
    ...path.points.map((point) => [
      formatPathMorphSignatureNumber(point.x),
      formatPathMorphSignatureNumber(point.y),
      formatPathMorphSignatureNumber(point.in?.x),
      formatPathMorphSignatureNumber(point.in?.y),
      formatPathMorphSignatureNumber(point.out?.x),
      formatPathMorphSignatureNumber(point.out?.y)
    ].join(","))
  ].join("|");
}
function getClosedPathMorphCandidateCacheKey(fromPath, toPath) {
  return `${getPathMorphSignature(fromPath)}=>${getPathMorphSignature(toPath)}`;
}
function rememberClosedPathMorphCandidate(cacheKey, candidate) {
  if (closedPathMorphCandidateCache.size >= CLOSED_PATH_MORPH_CANDIDATE_CACHE_LIMIT) {
    const oldestKey = closedPathMorphCandidateCache.keys().next().value;
    if (oldestKey) {
      closedPathMorphCandidateCache.delete(oldestKey);
      closedPathMorphPreparedCandidateCache.delete(oldestKey);
    }
  }
  closedPathMorphCandidateCache.set(cacheKey, candidate.name);
  closedPathMorphPreparedCandidateCache.set(cacheKey, candidate);
}
function flattenPathForMorphScore(path) {
  const firstPoint = path.points[0];
  const flattened = firstPoint ? [{ x: firstPoint.x, y: firstPoint.y }] : [];
  for (let segmentIndex = 0; segmentIndex < getPenSegmentCount(path.points, path.closed); segmentIndex += 1) {
    const segment = getPenSegmentControls(path.points, segmentIndex, path.closed);
    if (!segment) {
      continue;
    }
    if (segment.hasCurve) {
      for (let step = 1; step <= MORPH_SCORE_FLATTEN_STEPS; step += 1) {
        flattened.push(cubicPoint(
          segment.start,
          segment.cp1,
          segment.cp2,
          segment.end,
          step / MORPH_SCORE_FLATTEN_STEPS
        ));
      }
    } else {
      flattened.push({ x: segment.end.x, y: segment.end.y });
    }
  }
  return flattened;
}
function getFlattenedSignedArea(points) {
  let area = 0;
  const pointCount = points.length;
  if (pointCount < 3) {
    return 0;
  }
  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index];
    const nextPoint = points[(index + 1) % pointCount];
    if (point && nextPoint) {
      area += point.x * nextPoint.y - nextPoint.x * point.y;
    }
  }
  return area / 2;
}
function orientation(left, middle, right) {
  return (middle.y - left.y) * (right.x - middle.x) - (middle.x - left.x) * (right.y - middle.y);
}
function pointsEqual(left, right) {
  return distance2(left, right) <= ADAPTIVE_PROGRESS_EPSILON;
}
function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd)) <= Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd)) + ADAPTIVE_PROGRESS_EPSILON;
}
function segmentsIntersect(aStart, aEnd, bStart, bEnd) {
  if (pointsEqual(aStart, bStart) || pointsEqual(aStart, bEnd) || pointsEqual(aEnd, bStart) || pointsEqual(aEnd, bEnd)) {
    return false;
  }
  const o1 = orientation(aStart, aEnd, bStart);
  const o2 = orientation(aStart, aEnd, bEnd);
  const o3 = orientation(bStart, bEnd, aStart);
  const o4 = orientation(bStart, bEnd, aEnd);
  if (Math.abs(o1) <= ADAPTIVE_PROGRESS_EPSILON && Math.abs(o2) <= ADAPTIVE_PROGRESS_EPSILON && Math.abs(o3) <= ADAPTIVE_PROGRESS_EPSILON && Math.abs(o4) <= ADAPTIVE_PROGRESS_EPSILON) {
    return rangesOverlap(aStart.x, aEnd.x, bStart.x, bEnd.x) && rangesOverlap(aStart.y, aEnd.y, bStart.y, bEnd.y);
  }
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}
function countFlattenedSelfIntersections(points) {
  let intersections = 0;
  const segmentCount = points.length - 1;
  for (let leftIndex = 0; leftIndex < segmentCount; leftIndex += 1) {
    const leftStart = points[leftIndex];
    const leftEnd = points[leftIndex + 1];
    if (!leftStart || !leftEnd) {
      continue;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < segmentCount; rightIndex += 1) {
      if (Math.abs(leftIndex - rightIndex) <= 1 || leftIndex === 0 && rightIndex === segmentCount - 1) {
        continue;
      }
      const rightStart = points[rightIndex];
      const rightEnd = points[rightIndex + 1];
      if (rightStart && rightEnd && segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) {
        intersections += 1;
      }
    }
  }
  return intersections;
}
function analyzeClosedPathMorphCandidate(candidate) {
  const fromArea = Math.abs(getFlattenedSignedArea(flattenPathForMorphScore(candidate.fromPath)));
  const toArea = Math.abs(getFlattenedSignedArea(flattenPathForMorphScore(candidate.toPath)));
  const pointCountPenalty = candidate.fromPath.points.length * MORPH_SCORE_POINT_COUNT_PENALTY;
  let score = candidate.priority + pointCountPenalty;
  let selfIntersections = 0;
  let failedSamples = 0;
  let minAreaRatio = Number.POSITIVE_INFINITY;
  let areaCollapsePenalty = 0;
  MORPH_SCORE_SAMPLE_PROGRESS.forEach((progress) => {
    const interpolated = getPathOperationValue(interpolateParsedPathsResult(candidate.fromPath, candidate.toPath, progress));
    if (!interpolated) {
      failedSamples += 1;
      score += MORPH_SCORE_INTERSECTION_PENALTY;
      return;
    }
    const flattened = flattenPathForMorphScore(interpolated);
    const intersectionCount = countFlattenedSelfIntersections(flattened);
    const actualArea = Math.abs(getFlattenedSignedArea(flattened));
    const expectedArea = lerp(fromArea, toArea, progress);
    const intersectionPenalty = intersectionCount * MORPH_SCORE_INTERSECTION_PENALTY;
    selfIntersections += intersectionCount;
    score += intersectionPenalty;
    if (expectedArea > ADAPTIVE_PROGRESS_EPSILON) {
      const areaRatio = actualArea / expectedArea;
      minAreaRatio = Math.min(minAreaRatio, areaRatio);
      if (actualArea < expectedArea * 0.35) {
        const penalty = (expectedArea * 0.35 - actualArea) / expectedArea * MORPH_SCORE_AREA_COLLAPSE_PENALTY;
        areaCollapsePenalty += penalty;
        score += penalty;
      }
    }
  });
  return {
    name: candidate.name,
    priority: candidate.priority,
    score,
    pointCount: candidate.fromPath.points.length,
    pointCountPenalty,
    selfIntersections,
    failedSamples,
    minAreaRatio: Number.isFinite(minAreaRatio) ? minAreaRatio : 1,
    areaCollapsePenalty
  };
}
function isStableClosedPathMorphDiagnostic(diagnostic) {
  return diagnostic.failedSamples === 0 && diagnostic.selfIntersections === 0 && diagnostic.areaCollapsePenalty <= ADAPTIVE_PROGRESS_EPSILON && diagnostic.minAreaRatio >= MORPH_STABLE_MIN_AREA_RATIO;
}
function selectPreferredClosedPathMorphDiagnostic(diagnostics) {
  const stableDiagnostics = diagnostics.filter(isStableClosedPathMorphDiagnostic);
  for (const name of STABLE_CLOSED_PATH_MORPH_CANDIDATE_ORDER) {
    const diagnostic = stableDiagnostics.find((candidate) => candidate.name === name);
    if (diagnostic) {
      return diagnostic;
    }
  }
  return diagnostics[0] ?? null;
}
function getClosedPathMorphCandidateDiagnostics(candidates) {
  return candidates.map(analyzeClosedPathMorphCandidate).sort((left, right) => left.score - right.score);
}
function selectPreferredClosedPathMorphCandidate(candidates) {
  const diagnostics = getClosedPathMorphCandidateDiagnostics(candidates);
  const selectedDiagnostic = selectPreferredClosedPathMorphDiagnostic(diagnostics);
  return selectedDiagnostic ? candidates.find((candidate) => candidate.name === selectedDiagnostic.name) ?? null : null;
}
function getClosedPathMorphDiagnostics(fromPath, toPath) {
  if (!fromPath.closed || !toPath.closed) {
    return {
      applicable: false,
      reason: "open-path",
      selectedFromCache: false,
      candidates: []
    };
  }
  if (fromPath.points.length === toPath.points.length) {
    return {
      applicable: false,
      reason: "same-topology",
      selectedFromCache: false,
      candidates: []
    };
  }
  const candidates = createClosedPathMorphCandidates(fromPath, toPath);
  const cacheKey = getClosedPathMorphCandidateCacheKey(fromPath, toPath);
  const cachedCandidateName = closedPathMorphCandidateCache.get(cacheKey);
  const diagnostics = getClosedPathMorphCandidateDiagnostics(candidates);
  const selectedCandidateName = selectPreferredClosedPathMorphDiagnostic(diagnostics)?.name;
  const selectedCandidate = candidates.find((candidate) => candidate.name === selectedCandidateName);
  if (selectedCandidate) {
    rememberClosedPathMorphCandidate(cacheKey, selectedCandidate);
  }
  return {
    applicable: diagnostics.length > 0,
    reason: diagnostics.length > 0 ? void 0 : "no-candidates",
    selectedCandidateName,
    selectedFromCache: Boolean(cachedCandidateName && cachedCandidateName === selectedCandidateName),
    cachedCandidateName,
    candidates: diagnostics
  };
}
function selectClosedPathMorphCandidate(fromPath, toPath) {
  const cacheKey = getClosedPathMorphCandidateCacheKey(fromPath, toPath);
  const preparedCachedCandidate = closedPathMorphPreparedCandidateCache.get(cacheKey);
  const candidates = createClosedPathMorphCandidates(fromPath, toPath);
  if (preparedCachedCandidate) {
    const bestCandidate2 = selectPreferredClosedPathMorphCandidate(candidates);
    if (bestCandidate2?.name === preparedCachedCandidate.name) {
      return preparedCachedCandidate;
    }
    if (bestCandidate2) {
      rememberClosedPathMorphCandidate(cacheKey, bestCandidate2);
    }
    return bestCandidate2;
  }
  const cachedName = closedPathMorphCandidateCache.get(cacheKey);
  const cachedCandidate = cachedName ? candidates.find((candidate) => candidate.name === cachedName) : null;
  const bestCandidate = selectPreferredClosedPathMorphCandidate(candidates);
  if (cachedCandidate && bestCandidate?.name === cachedCandidate.name) {
    rememberClosedPathMorphCandidate(cacheKey, cachedCandidate);
    return cachedCandidate;
  }
  if (bestCandidate) {
    rememberClosedPathMorphCandidate(cacheKey, bestCandidate);
  }
  return bestCandidate;
}
function getPathAnchorProgresses(path) {
  const segmentLengths = getPathSegmentLengths(path);
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(totalLength) || totalLength <= ADAPTIVE_PROGRESS_EPSILON) {
    const denominator = path.closed ? path.points.length : Math.max(1, path.points.length - 1);
    return path.points.map((_, index) => index / Math.max(1, denominator));
  }
  const progresses = [];
  let offsetLength = 0;
  path.points.forEach((_, index) => {
    progresses.push(offsetLength / totalLength);
    offsetLength += segmentLengths[index] ?? 0;
  });
  return progresses;
}
function normalizeProgress(progress, closed) {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  if (!closed) {
    return Math.min(1, Math.max(0, progress));
  }
  const wrapped = progress % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}
function progressDistance(left, right, closed) {
  const delta = Math.abs(normalizeProgress(left, closed) - normalizeProgress(right, closed));
  return closed ? Math.min(delta, 1 - delta) : delta;
}
function mergeProgresses(left, right, closed) {
  const progresses = [...left, ...right].map((progress) => normalizeProgress(progress, closed)).filter((progress) => closed || progress <= 1);
  const sorted = progresses.sort((a, b) => a - b);
  const unique = [];
  sorted.forEach((progress) => {
    if (!unique.some((existing) => progressDistance(existing, progress, closed) <= ADAPTIVE_PROGRESS_EPSILON)) {
      unique.push(progress);
    }
  });
  if (!unique.some((progress) => progressDistance(progress, 0, closed) <= ADAPTIVE_PROGRESS_EPSILON)) {
    unique.unshift(0);
  }
  if (!closed && !unique.some((progress) => progressDistance(progress, 1, closed) <= ADAPTIVE_PROGRESS_EPSILON)) {
    unique.push(1);
  }
  return unique.sort((a, b) => a - b);
}
function findPathStartPointIndex(path) {
  let bestIndex = 0;
  path.points.forEach((point, index) => {
    const best = path.points[bestIndex];
    if (!best || point.y < best.y || point.y === best.y && point.x < best.x) {
      bestIndex = index;
    }
  });
  return bestIndex;
}
function rotateClosedPathStart(path) {
  if (!path.closed || path.points.length <= 2) {
    return cloneAnimationPath(path);
  }
  const startIndex = findPathStartPointIndex(path);
  if (startIndex <= 0) {
    return cloneAnimationPath(path);
  }
  return {
    closed: path.closed,
    points: [
      ...clonePenPoints(path.points.slice(startIndex)),
      ...clonePenPoints(path.points.slice(0, startIndex))
    ]
  };
}
function hasAnchorNearProgress(path, progress) {
  return getPathAnchorProgresses(path).some((anchorProgress) => progressDistance(anchorProgress, progress, path.closed) <= ADAPTIVE_PROGRESS_EPSILON);
}
function findPathSegmentAtProgress(path, progress) {
  const segmentLengths = getPathSegmentLengths(path);
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(totalLength) || totalLength <= ADAPTIVE_PROGRESS_EPSILON) {
    return null;
  }
  const targetLength = normalizeProgress(progress, path.closed) * totalLength;
  let offsetLength = 0;
  for (let segmentIndex = 0; segmentIndex < segmentLengths.length; segmentIndex += 1) {
    const segmentLength = segmentLengths[segmentIndex] ?? 0;
    const nextOffset = offsetLength + segmentLength;
    if (targetLength <= nextOffset + ADAPTIVE_PROGRESS_EPSILON) {
      if (segmentLength <= ADAPTIVE_PROGRESS_EPSILON) {
        return null;
      }
      return {
        segmentIndex,
        t: Math.min(0.95, Math.max(0.05, (targetLength - offsetLength) / segmentLength))
      };
    }
    offsetLength = nextOffset;
  }
  return null;
}
function addPathAnchorsAtProgresses(path, progresses) {
  let balancedPath = cloneAnimationPath(path);
  progresses.forEach((progress) => {
    if (hasAnchorNearProgress(balancedPath, progress)) {
      return;
    }
    const insertion = findPathSegmentAtProgress(balancedPath, progress);
    if (!insertion) {
      return;
    }
    balancedPath = {
      ...balancedPath,
      points: splitPenSegment(
        balancedPath.points,
        insertion.segmentIndex,
        balancedPath.closed,
        insertion.t
      )
    };
  });
  return balancedPath;
}
function prepareBalancedPaths(fromPath, toPath) {
  if (fromPath.closed !== toPath.closed || fromPath.points.length < 2 || toPath.points.length < 2) {
    return null;
  }
  const normalizedFromPath = normalizeClosedPathEndpoint(fromPath);
  const normalizedToPath = normalizeClosedPathEndpoint(toPath);
  const fromWinding = getPathWindingSign(normalizedFromPath);
  const toWinding = getPathWindingSign(normalizedToPath);
  const windingAlignedToPath = normalizedFromPath.closed && fromWinding !== 0 && toWinding !== 0 && fromWinding !== toWinding ? reversePathWinding(normalizedToPath) : normalizedToPath;
  const alignedFromPath = rotateClosedPathStart(normalizedFromPath);
  const alignedToPath = rotateClosedPathStart(windingAlignedToPath);
  const targetProgresses = mergeProgresses(
    getPathAnchorProgresses(alignedFromPath),
    getPathAnchorProgresses(alignedToPath),
    alignedFromPath.closed
  );
  const balancedFromPath = addPathAnchorsAtProgresses(alignedFromPath, targetProgresses);
  const balancedToPath = addPathAnchorsAtProgresses(alignedToPath, targetProgresses);
  if (balancedFromPath.points.length !== balancedToPath.points.length) {
    return null;
  }
  return {
    fromPath: balancedFromPath,
    toPath: balancedToPath
  };
}
function interpolateParsedPathsResult(fromPath, toPath, progress) {
  if (fromPath.closed !== toPath.closed || fromPath.points.length !== toPath.points.length) {
    return {
      ok: false,
      reason: createPathIssue("path-interpolate-incompatible", "Path interpolation requires matching point counts and closed state")
    };
  }
  return {
    ok: true,
    value: {
      closed: fromPath.closed,
      points: fromPath.points.map((fromPoint, index) => {
        const toPoint = toPath.points[index] ?? fromPoint;
        return {
          x: lerp(fromPoint.x, toPoint.x, progress),
          y: lerp(fromPoint.y, toPoint.y, progress),
          kind: fromPoint.kind === "smooth" || toPoint.kind === "smooth" ? "smooth" : "corner",
          mirroring: fromPoint.mirroring === "angle" || toPoint.mirroring === "angle" ? "angle" : "none",
          in: lerpHandle(fromPoint.in, toPoint.in, progress),
          out: lerpHandle(fromPoint.out, toPoint.out, progress),
          cornerRadius: lerp(fromPoint.cornerRadius ?? 0, toPoint.cornerRadius ?? 0, progress)
        };
      })
    }
  };
}
function createPathMorphPlan(strategy, fromPath, toPath, sourceFromPath, sourceToPath, selectedCandidateName) {
  return {
    strategy,
    fromPath: cloneAnimationPath(fromPath),
    toPath: cloneAnimationPath(toPath),
    sourceFromPointCount: sourceFromPath.points.length,
    sourceToPointCount: sourceToPath.points.length,
    selectedCandidateName,
    diagnostics: sourceFromPath.closed && sourceToPath.closed ? getClosedPathMorphDiagnostics(sourceFromPath, sourceToPath) : void 0
  };
}
function createBalancedParsedPathsPlanResult(fromPath, toPath) {
  const directResult = interpolateParsedPathsResult(fromPath, toPath, 0);
  if (directResult.ok && !fromPath.closed) {
    return {
      ok: true,
      value: createPathMorphPlan("direct-open", fromPath, toPath, fromPath, toPath)
    };
  }
  if (fromPath.closed && toPath.closed && fromPath.points.length !== toPath.points.length) {
    const candidate = selectClosedPathMorphCandidate(fromPath, toPath);
    if (candidate) {
      return {
        ok: true,
        value: createPathMorphPlan(
          `closed-candidate:${candidate.name}`,
          candidate.fromPath,
          candidate.toPath,
          fromPath,
          toPath,
          candidate.name
        )
      };
    }
  }
  const balancedPaths = prepareBalancedPaths(fromPath, toPath);
  if (!balancedPaths) {
    if (fromPath.closed && toPath.closed && fromPath.points.length !== toPath.points.length) {
      const lengthSampledPaths = prepareLengthSampledClosedPaths(fromPath, toPath);
      if (lengthSampledPaths) {
        return {
          ok: true,
          value: createPathMorphPlan(
            "length-sampled-fallback",
            lengthSampledPaths.fromPath,
            lengthSampledPaths.toPath,
            fromPath,
            toPath
          )
        };
      }
    }
    return directResult.ok ? {
      ok: true,
      value: createPathMorphPlan("direct-fallback", fromPath, toPath, fromPath, toPath)
    } : {
      ok: false,
      reason: directResult.reason
    };
  }
  const balancedResult = interpolateParsedPathsResult(balancedPaths.fromPath, balancedPaths.toPath, 0);
  if (!balancedResult.ok) {
    if (fromPath.closed && toPath.closed && fromPath.points.length !== toPath.points.length) {
      const lengthSampledPaths = prepareLengthSampledClosedPaths(fromPath, toPath);
      if (lengthSampledPaths) {
        return {
          ok: true,
          value: createPathMorphPlan(
            "length-sampled-after-balanced-failed",
            lengthSampledPaths.fromPath,
            lengthSampledPaths.toPath,
            fromPath,
            toPath
          )
        };
      }
    }
    return directResult.ok ? {
      ok: true,
      value: createPathMorphPlan("direct-after-balanced-failed", fromPath, toPath, fromPath, toPath)
    } : {
      ok: false,
      reason: directResult.reason
    };
  }
  return {
    ok: true,
    value: createPathMorphPlan("balanced", balancedPaths.fromPath, balancedPaths.toPath, fromPath, toPath)
  };
}
function interpolatePathMorphPlanResult(plan, progress) {
  return interpolateParsedPathsResult(plan.fromPath, plan.toPath, progress);
}
function interpolateBalancedParsedPathsResult(fromPath, toPath, progress) {
  const planResult = createBalancedParsedPathsPlanResult(fromPath, toPath);
  if (!planResult.ok) {
    return {
      ok: false,
      reason: planResult.reason
    };
  }
  return interpolatePathMorphPlanResult(planResult.value, progress);
}
function interpolateParsedPaths(fromPath, toPath, progress) {
  return getPathOperationValue(interpolateParsedPathsResult(fromPath, toPath, progress));
}
function mergePathIssues(...issueLists) {
  return issueLists.flat();
}
function interpolatePathDataResult(fromPathData, toPathData, progress) {
  const fromSource = normalizePathData(fromPathData);
  const toSource = normalizePathData(toPathData);
  if (!fromSource && !toSource) {
    return {
      ok: false,
      reason: createPathIssue("path-interpolate-empty", "Path interpolation failed because both source paths are empty")
    };
  }
  if (!fromSource) {
    const parsedTo = parseSvgPathDataResult(toSource);
    if (!parsedTo.ok) {
      return parsedTo;
    }
    return {
      ok: true,
      value: parsedTo.value,
      warnings: mergePathIssues(getPathOperationIssues(parsedTo), [
        createPathIssue(
          "path-interpolate-missing-from",
          "Path interpolation used the target path because the source path is empty",
          "single-endpoint-path"
        )
      ])
    };
  }
  if (!toSource) {
    const parsedFrom = parseSvgPathDataResult(fromSource);
    if (!parsedFrom.ok) {
      return parsedFrom;
    }
    return {
      ok: true,
      value: parsedFrom.value,
      warnings: mergePathIssues(getPathOperationIssues(parsedFrom), [
        createPathIssue(
          "path-interpolate-missing-to",
          "Path interpolation used the source path because the target path is empty",
          "single-endpoint-path"
        )
      ])
    };
  }
  const fromPathResult = parseSvgPathDataResult(fromSource);
  const toPathResult = parseSvgPathDataResult(toSource);
  const fromPath = getPathOperationValue(fromPathResult);
  const toPath = getPathOperationValue(toPathResult);
  const directResult = fromPath && toPath ? interpolateParsedPathsResult(fromPath, toPath, progress) : null;
  const directPath = directResult ? getPathOperationValue(directResult) : null;
  const parseIssues = mergePathIssues(getPathOperationIssues(fromPathResult), getPathOperationIssues(toPathResult));
  const directIssues = directResult ? mergePathIssues(parseIssues, getPathOperationIssues(directResult)) : parseIssues;
  if (directPath) {
    const warnings = directIssues;
    return warnings.length > 0 ? { ok: true, value: directPath, warnings } : { ok: true, value: directPath };
  }
  const sampledFromPathResult = sampleSvgPathDataResult(fromSource);
  const sampledToPathResult = sampleSvgPathDataResult(toSource);
  const sampledFromPath = getPathOperationValue(sampledFromPathResult);
  const sampledToPath = getPathOperationValue(sampledToPathResult);
  const adaptiveResult = sampledFromPath && sampledToPath ? interpolateParsedPathsResult(sampledFromPath, sampledToPath, progress) : null;
  const adaptivePath = adaptiveResult ? getPathOperationValue(adaptiveResult) : null;
  if (adaptivePath) {
    return {
      ok: true,
      value: adaptivePath,
      warnings: mergePathIssues(
        directIssues,
        getPathOperationIssues(sampledFromPathResult),
        getPathOperationIssues(sampledToPathResult),
        adaptiveResult ? getPathOperationIssues(adaptiveResult) : [],
        [createPathIssue(
          "path-interpolate-adaptive-fallback",
          "Path interpolation used adaptive sampled fallback because parsed paths are incompatible",
          "adaptive-sampled-path"
        )]
      )
    };
  }
  const fallback = progress >= 0.5 ? toPath ?? fromPath ?? void 0 : fromPath ?? toPath ?? void 0;
  const sampleIssues = mergePathIssues(
    getPathOperationIssues(sampledFromPathResult),
    getPathOperationIssues(sampledToPathResult),
    adaptiveResult ? getPathOperationIssues(adaptiveResult) : []
  );
  const fallbackReason = directIssues[0]?.message ?? sampleIssues[0]?.message ?? "unknown reason";
  const reason = createPathIssue(
    "path-interpolate-fallback",
    `Path interpolation failed (${fallbackReason}) and used the nearest parsed endpoint path`,
    "nearest-keyframe-path"
  );
  return fallback ? {
    ok: false,
    reason,
    fallback
  } : {
    ok: false,
    reason: sampleIssues[0] ?? directIssues[0] ?? reason
  };
}
function interpolatePathData(fromPathData, toPathData, progress) {
  return getPathOperationValue(interpolatePathDataResult(fromPathData, toPathData, progress));
}
export {
  createBalancedParsedPathsPlanResult,
  getClosedPathMorphDiagnostics,
  getPathOperationIssues,
  getPathOperationValue,
  interpolateBalancedParsedPathsResult,
  interpolateParsedPaths,
  interpolateParsedPathsResult,
  interpolatePathData,
  interpolatePathDataResult,
  interpolatePathMorphPlanResult,
  normalizePathData,
  parseSvgPathData,
  parseSvgPathDataResult,
  penPathToSvgPathData,
  scaleSvgPathData,
  scaleSvgPathDataResult,
  translateSvgPathData,
  translateSvgPathDataResult
};
