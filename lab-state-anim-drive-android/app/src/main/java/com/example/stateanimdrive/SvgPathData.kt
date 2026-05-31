package com.example.stateanimdrive

import android.graphics.Path
import android.graphics.PointF
import java.util.Locale
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

data class SvgPathCommand(
    val command: Char,
    val values: FloatArray
)

class SvgPathData private constructor(
    private val commands: List<SvgPathCommand>
) {
    fun toAndroidPath(): Path {
        val path = Path()
        var currentX = 0f
        var currentY = 0f
        var startX = 0f
        var startY = 0f
        var lastCubicX: Float? = null
        var lastCubicY: Float? = null
        var lastQuadX: Float? = null
        var lastQuadY: Float? = null

        fun resetSmoothControls() {
            lastCubicX = null
            lastCubicY = null
            lastQuadX = null
            lastQuadY = null
        }

        commands.forEach { item ->
            val cmd = item.command
            val v = item.values
            val relative = cmd.isLowerCase()

            when (cmd.uppercaseChar()) {
                'M' -> {
                    val x = if (relative) currentX + v[0] else v[0]
                    val y = if (relative) currentY + v[1] else v[1]
                    path.moveTo(x, y)
                    currentX = x
                    currentY = y
                    startX = x
                    startY = y
                    resetSmoothControls()
                }

                'L' -> {
                    val x = if (relative) currentX + v[0] else v[0]
                    val y = if (relative) currentY + v[1] else v[1]
                    path.lineTo(x, y)
                    currentX = x
                    currentY = y
                    resetSmoothControls()
                }

                'H' -> {
                    val x = if (relative) currentX + v[0] else v[0]
                    path.lineTo(x, currentY)
                    currentX = x
                    resetSmoothControls()
                }

                'V' -> {
                    val y = if (relative) currentY + v[0] else v[0]
                    path.lineTo(currentX, y)
                    currentY = y
                    resetSmoothControls()
                }

                'C' -> {
                    val x1 = if (relative) currentX + v[0] else v[0]
                    val y1 = if (relative) currentY + v[1] else v[1]
                    val x2 = if (relative) currentX + v[2] else v[2]
                    val y2 = if (relative) currentY + v[3] else v[3]
                    val x = if (relative) currentX + v[4] else v[4]
                    val y = if (relative) currentY + v[5] else v[5]
                    path.cubicTo(x1, y1, x2, y2, x, y)
                    currentX = x
                    currentY = y
                    lastCubicX = x2
                    lastCubicY = y2
                    lastQuadX = null
                    lastQuadY = null
                }

                'S' -> {
                    val x1 = if (lastCubicX != null && lastCubicY != null) {
                        2f * currentX - lastCubicX!!
                    } else {
                        currentX
                    }
                    val y1 = if (lastCubicX != null && lastCubicY != null) {
                        2f * currentY - lastCubicY!!
                    } else {
                        currentY
                    }
                    val x2 = if (relative) currentX + v[0] else v[0]
                    val y2 = if (relative) currentY + v[1] else v[1]
                    val x = if (relative) currentX + v[2] else v[2]
                    val y = if (relative) currentY + v[3] else v[3]
                    path.cubicTo(x1, y1, x2, y2, x, y)
                    currentX = x
                    currentY = y
                    lastCubicX = x2
                    lastCubicY = y2
                    lastQuadX = null
                    lastQuadY = null
                }

                'Q' -> {
                    val x1 = if (relative) currentX + v[0] else v[0]
                    val y1 = if (relative) currentY + v[1] else v[1]
                    val x = if (relative) currentX + v[2] else v[2]
                    val y = if (relative) currentY + v[3] else v[3]
                    path.quadTo(x1, y1, x, y)
                    currentX = x
                    currentY = y
                    lastQuadX = x1
                    lastQuadY = y1
                    lastCubicX = null
                    lastCubicY = null
                }

                'T' -> {
                    val x1 = if (lastQuadX != null && lastQuadY != null) {
                        2f * currentX - lastQuadX!!
                    } else {
                        currentX
                    }
                    val y1 = if (lastQuadX != null && lastQuadY != null) {
                        2f * currentY - lastQuadY!!
                    } else {
                        currentY
                    }
                    val x = if (relative) currentX + v[0] else v[0]
                    val y = if (relative) currentY + v[1] else v[1]
                    path.quadTo(x1, y1, x, y)
                    currentX = x
                    currentY = y
                    lastQuadX = x1
                    lastQuadY = y1
                    lastCubicX = null
                    lastCubicY = null
                }

                'A' -> {
                    val x = if (relative) currentX + v[5] else v[5]
                    val y = if (relative) currentY + v[6] else v[6]
                    path.lineTo(x, y)
                    currentX = x
                    currentY = y
                    resetSmoothControls()
                }

                'Z' -> {
                    path.close()
                    currentX = startX
                    currentY = startY
                    resetSmoothControls()
                }
            }
        }

        return path
    }

    fun bounds(): PathBounds? {
        var currentX = 0f
        var currentY = 0f
        var startX = 0f
        var startY = 0f
        var hasPoint = false
        var minX = Float.POSITIVE_INFINITY
        var minY = Float.POSITIVE_INFINITY
        var maxX = Float.NEGATIVE_INFINITY
        var maxY = Float.NEGATIVE_INFINITY

        fun include(x: Float, y: Float) {
            hasPoint = true
            minX = min(minX, x)
            minY = min(minY, y)
            maxX = max(maxX, x)
            maxY = max(maxY, y)
        }

        commands.forEach { item ->
            val cmd = item.command
            val v = item.values
            val relative = cmd.isLowerCase()

            when (cmd.uppercaseChar()) {
                'M', 'L', 'T' -> {
                    val x = if (relative) currentX + v[0] else v[0]
                    val y = if (relative) currentY + v[1] else v[1]
                    include(x, y)
                    currentX = x
                    currentY = y
                    if (cmd.uppercaseChar() == 'M') {
                        startX = x
                        startY = y
                    }
                }
                'H' -> {
                    val x = if (relative) currentX + v[0] else v[0]
                    include(x, currentY)
                    currentX = x
                }
                'V' -> {
                    val y = if (relative) currentY + v[0] else v[0]
                    include(currentX, y)
                    currentY = y
                }
                'C' -> {
                    for (index in 0 until 6 step 2) {
                        include(
                            if (relative) currentX + v[index] else v[index],
                            if (relative) currentY + v[index + 1] else v[index + 1]
                        )
                    }
                    currentX = if (relative) currentX + v[4] else v[4]
                    currentY = if (relative) currentY + v[5] else v[5]
                }
                'S', 'Q' -> {
                    for (index in v.indices step 2) {
                        include(
                            if (relative) currentX + v[index] else v[index],
                            if (relative) currentY + v[index + 1] else v[index + 1]
                        )
                    }
                    currentX = if (relative) currentX + v[v.size - 2] else v[v.size - 2]
                    currentY = if (relative) currentY + v[v.size - 1] else v[v.size - 1]
                }
                'A' -> {
                    val x = if (relative) currentX + v[5] else v[5]
                    val y = if (relative) currentY + v[6] else v[6]
                    include(x, y)
                    currentX = x
                    currentY = y
                }
                'Z' -> {
                    currentX = startX
                    currentY = startY
                    include(currentX, currentY)
                }
            }
        }

        return if (hasPoint) PathBounds(minX, minY, maxX, maxY) else null
    }

    fun translated(dx: Float, dy: Float): SvgPathData {
        if (dx == 0f && dy == 0f) return this

        val translated = commands.map { item ->
            val values = item.values.copyOf()
            when (item.command) {
                'M', 'L', 'T' -> {
                    values[0] += dx
                    values[1] += dy
                }
                'H' -> values[0] += dx
                'V' -> values[0] += dy
                'C' -> {
                    for (index in 0 until values.size step 2) {
                        values[index] += dx
                        values[index + 1] += dy
                    }
                }
                'S', 'Q' -> {
                    for (index in 0 until values.size step 2) {
                        values[index] += dx
                        values[index + 1] += dy
                    }
                }
                'A' -> {
                    values[5] += dx
                    values[6] += dy
                }
            }
            SvgPathCommand(item.command, values)
        }

        return SvgPathData(translated)
    }

    fun interpolate(other: SvgPathData, progress: Float): SvgPathData? {
        if (commands.size != other.commands.size) return null

        val t = progress.coerceIn(0f, 1f)
        val result = commands.zip(other.commands).map { (left, right) ->
            if (left.command != right.command || left.values.size != right.values.size) {
                return null
            }

            val values = FloatArray(left.values.size) { index ->
                left.values[index] + (right.values[index] - left.values[index]) * t
            }
            SvgPathCommand(left.command, values)
        }

        return SvgPathData(result)
    }

    fun morphTo(other: SvgPathData, progress: Float): SvgPathData {
        val fromClosed = isClosed()
        val toClosed = other.isClosed()

        if (!fromClosed && !toClosed) {
            interpolate(other, progress)?.let { return it }
        }

        val fromPoints = samplePoints(MORPH_SAMPLE_COUNT, fromClosed)
        val rawToPoints = other.samplePoints(MORPH_SAMPLE_COUNT, toClosed)

        if (fromPoints.isEmpty() || rawToPoints.isEmpty()) {
            return if (progress < 0.5f) this else other
        }

        val t = progress.coerceIn(0f, 1f)
        val closed = fromClosed && toClosed
        val toPoints = when {
            closed -> alignClosedPoints(fromPoints, rawToPoints)
            !fromClosed && !toClosed -> alignOpenPoints(fromPoints, rawToPoints)
            else -> rawToPoints
        }
        val commands = mutableListOf<SvgPathCommand>()

        fromPoints.zip(toPoints).forEachIndexed { index, (from, to) ->
            val x = from.x + (to.x - from.x) * t
            val y = from.y + (to.y - from.y) * t
            commands += SvgPathCommand(if (index == 0) 'M' else 'L', floatArrayOf(x, y))
        }

        if (closed) {
            commands += SvgPathCommand('Z', FloatArray(0))
        }

        return SvgPathData(commands)
    }

    fun toSvgString(): String = buildString {
        commands.forEach { item ->
            append(item.command)
            item.values.forEach { value ->
                append(' ')
                append(formatFloat(value))
            }
            append(' ')
        }
    }.trim()

    private fun isClosed(): Boolean =
        commands.any { it.command.uppercaseChar() == 'Z' }

    private fun samplePoints(count: Int, closed: Boolean): List<PointF> {
        val segments = absoluteSegments()
        if (segments.isEmpty()) return emptyList()

        val lengths = segments.map { it.approximateLength() }
        val totalLength = lengths.sum()
        if (totalLength <= 0f) return List(count) { segments.first().pointAt(0f) }

        val result = mutableListOf<PointF>()
        var segmentIndex = 0
        var consumedLength = 0f

        repeat(count) { pointIndex ->
            val denominator = if (closed) count else (count - 1).coerceAtLeast(1)
            val targetLength = totalLength * pointIndex / denominator

            while (
                segmentIndex < segments.lastIndex &&
                consumedLength + lengths[segmentIndex] < targetLength
            ) {
                consumedLength += lengths[segmentIndex]
                segmentIndex += 1
            }

            val segmentLength = lengths[segmentIndex].coerceAtLeast(0.0001f)
            val localT = ((targetLength - consumedLength) / segmentLength).coerceIn(0f, 1f)
            result += segments[segmentIndex].pointAt(localT)
        }

        return result
    }

    private fun alignOpenPoints(fromPoints: List<PointF>, toPoints: List<PointF>): List<PointF> {
        if (fromPoints.size != toPoints.size || fromPoints.size < 2) return toPoints

        val directScore = pointListDistanceScore(fromPoints, toPoints)
        val reversed = toPoints.asReversed()
        val reversedScore = pointListDistanceScore(fromPoints, reversed)

        return if (reversedScore < directScore) reversed else toPoints
    }

    private fun alignClosedPoints(fromPoints: List<PointF>, toPoints: List<PointF>): List<PointF> {
        if (fromPoints.size != toPoints.size || fromPoints.size < 3) return toPoints

        val direct = bestClosedShift(fromPoints, toPoints)
        val reversed = bestClosedShift(fromPoints, toPoints.asReversed())

        return if (reversed.score < direct.score) reversed.points else direct.points
    }

    private fun bestClosedShift(fromPoints: List<PointF>, toPoints: List<PointF>): ClosedPointAlignment {
        var bestScore = Float.POSITIVE_INFINITY
        var bestShift = 0
        val count = fromPoints.size

        for (shift in 0 until count) {
            var score = 0f

            for (index in 0 until count) {
                score += distanceSquared(fromPoints[index], toPoints[(index + shift) % count])
                if (score >= bestScore) break
            }

            if (score < bestScore) {
                bestScore = score
                bestShift = shift
            }
        }

        return ClosedPointAlignment(
            score = bestScore,
            points = List(count) { index -> toPoints[(index + bestShift) % count] }
        )
    }

    private fun pointListDistanceScore(fromPoints: List<PointF>, toPoints: List<PointF>): Float {
        val count = min(fromPoints.size, toPoints.size)
        var score = 0f

        for (index in 0 until count) {
            score += distanceSquared(fromPoints[index], toPoints[index])
        }

        return score
    }

    private fun absoluteSegments(): List<PathSegment> {
        val segments = mutableListOf<PathSegment>()
        var current = PointF(0f, 0f)
        var contourStart = PointF(0f, 0f)
        var lastCubicControl: PointF? = null
        var lastQuadControl: PointF? = null

        fun point(x: Float, y: Float, relative: Boolean): PointF =
            if (relative) PointF(current.x + x, current.y + y) else PointF(x, y)

        fun resetControls() {
            lastCubicControl = null
            lastQuadControl = null
        }

        commands.forEach { item ->
            val relative = item.command.isLowerCase()
            val v = item.values

            when (item.command.uppercaseChar()) {
                'M' -> {
                    current = point(v[0], v[1], relative)
                    contourStart = PointF(current.x, current.y)
                    resetControls()
                }

                'L' -> {
                    val end = point(v[0], v[1], relative)
                    segments += PathSegment.Line(current, end)
                    current = end
                    resetControls()
                }

                'H' -> {
                    val end = PointF(if (relative) current.x + v[0] else v[0], current.y)
                    segments += PathSegment.Line(current, end)
                    current = end
                    resetControls()
                }

                'V' -> {
                    val end = PointF(current.x, if (relative) current.y + v[0] else v[0])
                    segments += PathSegment.Line(current, end)
                    current = end
                    resetControls()
                }

                'C' -> {
                    val cp1 = point(v[0], v[1], relative)
                    val cp2 = point(v[2], v[3], relative)
                    val end = point(v[4], v[5], relative)
                    segments += PathSegment.Cubic(current, cp1, cp2, end)
                    current = end
                    lastCubicControl = cp2
                    lastQuadControl = null
                }

                'S' -> {
                    val cp1 = lastCubicControl?.let {
                        PointF(2f * current.x - it.x, 2f * current.y - it.y)
                    } ?: PointF(current.x, current.y)
                    val cp2 = point(v[0], v[1], relative)
                    val end = point(v[2], v[3], relative)
                    segments += PathSegment.Cubic(current, cp1, cp2, end)
                    current = end
                    lastCubicControl = cp2
                    lastQuadControl = null
                }

                'Q' -> {
                    val cp = point(v[0], v[1], relative)
                    val end = point(v[2], v[3], relative)
                    segments += PathSegment.Quad(current, cp, end)
                    current = end
                    lastQuadControl = cp
                    lastCubicControl = null
                }

                'T' -> {
                    val cp = lastQuadControl?.let {
                        PointF(2f * current.x - it.x, 2f * current.y - it.y)
                    } ?: PointF(current.x, current.y)
                    val end = point(v[0], v[1], relative)
                    segments += PathSegment.Quad(current, cp, end)
                    current = end
                    lastQuadControl = cp
                    lastCubicControl = null
                }

                'A' -> {
                    val end = point(v[5], v[6], relative)
                    segments += PathSegment.Line(current, end)
                    current = end
                    resetControls()
                }

                'Z' -> {
                    segments += PathSegment.Line(current, contourStart)
                    current = PointF(contourStart.x, contourStart.y)
                    resetControls()
                }
            }
        }

        return segments
    }

    private sealed class PathSegment {
        abstract fun pointAt(t: Float): PointF

        fun approximateLength(): Float {
            var length = 0f
            var previous = pointAt(0f)

            for (index in 1..SEGMENT_LENGTH_STEPS) {
                val current = pointAt(index / SEGMENT_LENGTH_STEPS.toFloat())
                length += distance(previous, current)
                previous = current
            }

            return length
        }

        data class Line(val start: PointF, val end: PointF) : PathSegment() {
            override fun pointAt(t: Float): PointF = lerp(start, end, t)
        }

        data class Quad(val start: PointF, val cp: PointF, val end: PointF) : PathSegment() {
            override fun pointAt(t: Float): PointF {
                val a = lerp(start, cp, t)
                val b = lerp(cp, end, t)
                return lerp(a, b, t)
            }
        }

        data class Cubic(val start: PointF, val cp1: PointF, val cp2: PointF, val end: PointF) : PathSegment() {
            override fun pointAt(t: Float): PointF {
                val a = lerp(start, cp1, t)
                val b = lerp(cp1, cp2, t)
                val c = lerp(cp2, end, t)
                val d = lerp(a, b, t)
                val e = lerp(b, c, t)
                return lerp(d, e, t)
            }
        }
    }

    private data class ClosedPointAlignment(
        val score: Float,
        val points: List<PointF>
    )

    companion object {
        private const val MORPH_SAMPLE_COUNT = 96
        private const val SEGMENT_LENGTH_STEPS = 10
        private val tokenRegex = Regex("[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:(?:\\d*\\.\\d+)|(?:\\d+\\.?))(?:[eE][-+]?\\d+)?")

        fun parse(source: String?): SvgPathData? {
            if (source.isNullOrBlank()) return null

            val tokens = tokenRegex.findAll(source).map { it.value }.toList()
            if (tokens.isEmpty()) return null

            val commands = mutableListOf<SvgPathCommand>()
            var index = 0
            var command: Char? = null

            while (index < tokens.size) {
                if (isCommandToken(tokens[index])) {
                    command = tokens[index].first()
                    index += 1
                }

                val currentCommand = command ?: return null
                val arity = commandArity(currentCommand)

                if (arity == 0) {
                    commands += SvgPathCommand(currentCommand, FloatArray(0))
                    command = null
                    continue
                }

                var firstMove = true
                while (index < tokens.size && !isCommandToken(tokens[index])) {
                    if (index + arity > tokens.size) break

                    val values = FloatArray(arity)
                    for (valueIndex in 0 until arity) {
                        val token = tokens[index + valueIndex]
                        if (isCommandToken(token)) return null
                        values[valueIndex] = token.toFloatOrNull() ?: return null
                    }

                    val outputCommand = if (currentCommand == 'M' && !firstMove) {
                        'L'
                    } else if (currentCommand == 'm' && !firstMove) {
                        'l'
                    } else {
                        currentCommand
                    }

                    commands += SvgPathCommand(outputCommand, values)
                    index += arity
                    firstMove = false

                    if (index < tokens.size && isCommandToken(tokens[index])) break
                }
            }

            return if (commands.isEmpty()) null else SvgPathData(commands)
        }

        private fun isCommandToken(token: String): Boolean =
            token.length == 1 && token[0].isLetter()

        private fun commandArity(command: Char): Int = when (command.uppercaseChar()) {
            'M', 'L', 'T' -> 2
            'H', 'V' -> 1
            'C' -> 6
            'S', 'Q' -> 4
            'A' -> 7
            'Z' -> 0
            else -> 0
        }

        private fun formatFloat(value: Float): String {
            val rounded = String.format(Locale.US, "%.4f", value)
            return rounded.trimEnd('0').trimEnd('.')
        }

        private fun lerp(from: PointF, to: PointF, t: Float): PointF =
            PointF(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)

        private fun distance(from: PointF, to: PointF): Float =
            hypot((to.x - from.x), (to.y - from.y))

        private fun distanceSquared(from: PointF, to: PointF): Float {
            val dx = to.x - from.x
            val dy = to.y - from.y
            return dx * dx + dy * dy
        }
    }
}
