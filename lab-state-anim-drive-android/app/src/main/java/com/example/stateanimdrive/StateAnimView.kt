package com.example.stateanimdrive

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import kotlin.math.min
import kotlin.math.roundToInt

class StateAnimView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {
    var runtimePackage: StateAnimPackage? = null
        set(value) {
            field = value
            pathCache.clear()
            invalidate()
        }

    var snapshot: RenderSnapshot? = null
        set(value) {
            field = value
            invalidate()
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val pathCache = linkedMapOf<String, Path>()
    private val tmpRect = RectF()

    init {
        strokePaint.style = Paint.Style.STROKE
        strokePaint.strokeJoin = Paint.Join.ROUND
        strokePaint.strokeCap = Paint.Cap.ROUND
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val currentPackage = runtimePackage ?: return drawEmpty(canvas)
        val currentSnapshot = snapshot ?: return drawEmpty(canvas)
        val scale = min(
            width / currentPackage.boardWidth,
            height / currentPackage.boardHeight
        ) * 0.9f

        canvas.drawColor(parseColorSafe("#0F172A"))
        canvas.save()
        canvas.translate(width / 2f, height / 2f)
        canvas.scale(scale, scale)

        drawStageBackground(canvas, currentPackage)
        currentSnapshot.passes.forEach { pass ->
            drawPass(canvas, pass, currentSnapshot.projectedOverrides)
        }

        canvas.restore()
    }

    private fun drawEmpty(canvas: Canvas) {
        canvas.drawColor(parseColorSafe("#0F172A"))
        paint.style = Paint.Style.FILL
        paint.color = parseColorSafe("#E5E7EB")
        paint.textSize = 38f
        paint.textAlign = Paint.Align.CENTER
        canvas.drawText("Loading state anim...", width / 2f, height / 2f, paint)
    }

    private fun drawStageBackground(canvas: Canvas, runtimePackage: StateAnimPackage) {
        val halfW = runtimePackage.boardWidth / 2f
        val halfH = runtimePackage.boardHeight / 2f

        paint.style = Paint.Style.FILL
        paint.color = if (runtimePackage.frameTransparent) parseColorSafe("#111827") else parseColorSafe("#FFFFFF")
        canvas.drawRect(-halfW, -halfH, halfW, halfH, paint)

        strokePaint.color = parseColorSafe("#E2E8F0")
        strokePaint.alpha = 70
        strokePaint.strokeWidth = 1f

        var x = -halfW
        while (x <= halfW) {
            canvas.drawLine(x, -halfH, x, halfH, strokePaint)
            x += 40f
        }

        var y = -halfH
        while (y <= halfH) {
            canvas.drawLine(-halfW, y, halfW, y, strokePaint)
            y += 40f
        }
    }

    private fun drawPass(
        canvas: Canvas,
        pass: RenderPass,
        projectedOverrides: Map<String, ProjectedLayerOverride>
    ) {
        pass.clip.rootLayerKeys.forEach { key ->
            drawLayer(canvas, pass, key, pass.alpha, projectedOverrides)
        }
    }

    private fun drawLayer(
        canvas: Canvas,
        pass: RenderPass,
        key: String,
        parentAlpha: Float,
        projectedOverrides: Map<String, ProjectedLayerOverride>
    ) {
        val clip = pass.clip
        val layer = clip.renderLayerByKey[key] ?: return
        val shouldDrawSelf = pass.includedLayerKeys == null || pass.includedLayerKeys.contains(key)
        val shouldVisit = shouldDrawSelf || hasIncludedDescendant(clip, key, pass.includedLayerKeys)

        if (!shouldVisit) return

        val sampled = StateAnimPlayer.evaluateLayer(layer, pass.frame)
        val motionExplicit = sampled.copyOverride()
        pass.layerOverrides[key]?.let {
            sampled.mergeFrom(it)
            motionExplicit.mergeFrom(it)
        }
        projectedOverrides[layer.matchKey]?.let {
            applyProjectedOverride(sampled, it, pass.priority, motionExplicit)
        }

        val opacity = clamp(sampled.opacity ?: layer.baseOpacity, 0f, 1f)
        val layerAlpha = parentAlpha * opacity
        if (layerAlpha <= 0.001f) return

        canvas.save()
        applyLayerTransform(canvas, layer, sampled)

        if (layer.clipContent) {
            canvas.clipRect(0f, 0f, layer.width, layer.height)
        }

        if (shouldDrawSelf && layer.kind == "frame") {
            drawFrame(canvas, layer, sampled, layerAlpha)
        }

        if (shouldDrawSelf) {
            drawVectorParts(canvas, layer, sampled, layerAlpha)
        }

        layer.children.forEach { childKey ->
            drawLayer(canvas, pass, childKey, layerAlpha, projectedOverrides)
        }

        canvas.restore()
    }

    private fun applyProjectedOverride(
        target: LayerOverride,
        projected: ProjectedLayerOverride,
        motionPriority: Int,
        motionExplicit: LayerOverride
    ) {
        val override = projected.override

        if (canApplyProjected(projected, "transform", hasExplicitTransform(motionExplicit), motionPriority)) {
            override.x?.let { target.x = it }
            override.y?.let { target.y = it }
            override.scaleX?.let { target.scaleX = it }
            override.scaleY?.let { target.scaleY = it }
            override.rotation?.let { target.rotation = it }
        }

        if (canApplyProjected(projected, "opacity", motionExplicit.opacity != null, motionPriority)) {
            override.opacity?.let { target.opacity = it }
        }
        if (canApplyProjected(projected, "fill", motionExplicit.fill != null, motionPriority)) {
            override.fill?.let { target.fill = it }
        }
        if (canApplyProjected(projected, "stroke", motionExplicit.stroke != null, motionPriority)) {
            override.stroke?.let { target.stroke = it }
        }
        if (canApplyProjected(projected, "path", motionExplicit.pathData != null, motionPriority)) {
            override.pathData?.let { target.pathData = it }
        }
    }

    private fun canApplyProjected(
        projected: ProjectedLayerOverride,
        property: String,
        hasMotionExplicitValue: Boolean,
        motionPriority: Int
    ): Boolean {
        val projectedPriority = projected.propertyPriorities[property] ?: return false
        return projectedPriority >= motionPriority || !hasMotionExplicitValue
    }

    private fun hasExplicitTransform(override: LayerOverride): Boolean =
        override.x != null || override.y != null ||
            override.scaleX != null || override.scaleY != null ||
            override.rotation != null

    private fun hasIncludedDescendant(clip: MotionClip, key: String, includedKeys: Set<String>?): Boolean {
        if (includedKeys == null) return true

        val layer = clip.renderLayerByKey[key] ?: return false
        return layer.children.any { childKey ->
            includedKeys.contains(childKey) || hasIncludedDescendant(clip, childKey, includedKeys)
        }
    }

    private fun applyLayerTransform(canvas: Canvas, layer: RenderLayer, override: LayerOverride) {
        val x = override.x ?: layer.baseX
        val y = override.y ?: layer.baseY
        val scaleX = override.scaleX ?: layer.baseScaleX
        val scaleY = override.scaleY ?: layer.baseScaleY
        val rotation = override.rotation ?: layer.baseRotation

        canvas.translate(x + layer.pivotX, y + layer.pivotY)
        canvas.rotate(rotation)
        canvas.scale(scaleX, scaleY)
        canvas.translate(-layer.pivotX, -layer.pivotY)
    }

    private fun drawFrame(canvas: Canvas, layer: RenderLayer, override: LayerOverride, alpha: Float) {
        val fill = override.fill ?: layer.baseFill
        if (layer.fillVisible && fill != null && layer.fillOpacity > 0f) {
            paint.style = Paint.Style.FILL
            paint.color = parseColorSafe(fill, "#FFFFFF")
            paint.alpha = alphaToPaint(alpha * layer.fillOpacity)
            tmpRect.set(0f, 0f, layer.width, layer.height)
            canvas.drawRoundRect(tmpRect, layer.radius, layer.radius, paint)
        }

        val stroke = override.stroke ?: layer.baseStroke
        if (layer.strokeVisible && stroke != null && layer.baseStrokeWidth > 0f && layer.strokeOpacity > 0f) {
            strokePaint.color = parseColorSafe(stroke)
            strokePaint.alpha = alphaToPaint(alpha * layer.strokeOpacity)
            strokePaint.strokeWidth = layer.baseStrokeWidth
            tmpRect.set(0f, 0f, layer.width, layer.height)
            canvas.drawRoundRect(tmpRect, layer.radius, layer.radius, strokePaint)
        }
    }

    private fun drawVectorParts(canvas: Canvas, layer: RenderLayer, override: LayerOverride, alpha: Float) {
        if (layer.faceParts.isEmpty()) return

        layer.faceParts.forEachIndexed { index, part ->
            val pathData = if (index == 0) override.pathData ?: part.pathData else part.pathData
            val path = cachedPath(pathData) ?: return@forEachIndexed
            val fill = override.fill ?: part.fill.ifBlank { layer.baseFill ?: "#000000" }

            paint.style = Paint.Style.FILL
            paint.color = parseColorSafe(fill)
            paint.alpha = alphaToPaint(alpha)
            canvas.drawPath(path, paint)

            val stroke = override.stroke ?: part.stroke ?: layer.baseStroke
            val strokeWidth = if (part.strokeWidth > 0f) part.strokeWidth else layer.baseStrokeWidth
            if (stroke != null && strokeWidth > 0f) {
                strokePaint.color = parseColorSafe(stroke)
                strokePaint.alpha = alphaToPaint(alpha)
                strokePaint.strokeWidth = strokeWidth
                canvas.drawPath(path, strokePaint)
            }
        }
    }

    private fun cachedPath(pathData: String): Path? {
        if (pathCache.size > 512) {
            pathCache.clear()
        }

        return pathCache.getOrPut(pathData) {
            SvgPathData.parse(pathData)?.toAndroidPath() ?: Path()
        }
    }

    private fun alphaToPaint(alpha: Float): Int =
        (clamp(alpha, 0f, 1f) * 255f).roundToInt().coerceIn(0, 255)
}
