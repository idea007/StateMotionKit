package com.example.stateanimdrive

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

fun clamp(value: Float, minValue: Float, maxValue: Float): Float =
    max(minValue, min(maxValue, value))

fun Any?.asFloat(fallback: Float = 0f): Float = when (this) {
    is Number -> this.toFloat()
    is String -> this.toFloatOrNull() ?: fallback
    else -> fallback
}

fun JSONObject.optStringOrNull(name: String): String? =
    if (has(name) && !isNull(name)) optString(name) else null

fun JSONObject.optObject(name: String): JSONObject? =
    if (has(name) && !isNull(name)) optJSONObject(name) else null

fun JSONObject.optArray(name: String): JSONArray? =
    if (has(name) && !isNull(name)) optJSONArray(name) else null

fun JSONArray.objects(): List<JSONObject> =
    (0 until length()).mapNotNull { index -> optJSONObject(index) }

fun JSONArray.strings(): List<String> =
    (0 until length()).map { index -> optString(index) }

fun normalizeHexColor(value: String?, fallback: String = "#000000"): String {
    val raw = value?.trim().orEmpty()
    if (!raw.startsWith("#")) return fallback

    val hex = raw.drop(1)
    val normalized = when (hex.length) {
        3 -> hex.map { "$it$it" }.joinToString("")
        6 -> hex
        8 -> hex.takeLast(6)
        else -> return fallback
    }

    return "#${normalized.uppercase()}"
}

fun parseColorSafe(value: String?, fallback: String = "#000000"): Int =
    Color.parseColor(normalizeHexColor(value, fallback))

fun mixColor(from: String, to: String, progress: Float): String {
    val left = parseColorSafe(from)
    val right = parseColorSafe(to)
    val t = clamp(progress, 0f, 1f)

    val red = (Color.red(left) + (Color.red(right) - Color.red(left)) * t).toInt()
    val green = (Color.green(left) + (Color.green(right) - Color.green(left)) * t).toInt()
    val blue = (Color.blue(left) + (Color.blue(right) - Color.blue(left)) * t).toInt()

    return "#%02X%02X%02X".format(red.coerceIn(0, 255), green.coerceIn(0, 255), blue.coerceIn(0, 255))
}

fun easingProgress(easing: Easing, rawProgress: Float): Float {
    val t = clamp(rawProgress, 0f, 1f)

    return when (easing) {
        Easing.Linear -> t
        Easing.Hold -> 0f
        is Easing.CubicBezier -> cubicBezierProgress(easing.x1, easing.y1, easing.x2, easing.y2, t)
    }
}

private fun cubicBezierProgress(x1: Float, y1: Float, x2: Float, y2: Float, progress: Float): Float {
    var t = progress

    repeat(6) {
        val x = cubic(t, x1, x2) - progress
        val derivative = cubicDerivative(t, x1, x2)

        if (abs(x) < 0.00001f || abs(derivative) < 0.00001f) return@repeat
        t = clamp(t - x / derivative, 0f, 1f)
    }

    var lower = 0f
    var upper = 1f

    repeat(14) {
        val x = cubic(t, x1, x2)
        if (abs(x - progress) < 0.00001f) return@repeat

        if (x < progress) {
            lower = t
        } else {
            upper = t
        }
        t = (lower + upper) / 2f
    }

    return cubic(t, y1, y2)
}

private fun cubic(t: Float, p1: Float, p2: Float): Float {
    val inverse = 1f - t
    return 3f * inverse * inverse * t * p1 +
        3f * inverse * t * t * p2 +
        t * t * t
}

private fun cubicDerivative(t: Float, p1: Float, p2: Float): Float {
    val inverse = 1f - t
    return 3f * inverse * inverse * p1 +
        6f * inverse * t * (p2 - p1) +
        3f * t * t * (1f - p2)
}
