package com.example.stateanimdrive

import android.app.Activity
import android.os.Bundle
import android.view.Choreographer
import android.view.Gravity
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var stageView: StateAnimView
    private lateinit var statusView: TextView
    private lateinit var speedView: TextView
    private lateinit var playButton: Button
    private lateinit var controlsPanel: LinearLayout

    private var runtimePackage: StateAnimPackage? = null
    private var player: StateAnimPlayer? = null
    private var playing = true
    private var speed = 1f
    private var lastFrameNanos = 0L
    private val optionButtons = mutableMapOf<String, MutableList<Button>>()

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            val currentPlayer = player
            if (playing && currentPlayer != null) {
                if (lastFrameNanos == 0L) {
                    lastFrameNanos = frameTimeNanos
                }

                val deltaSeconds = (frameTimeNanos - lastFrameNanos) / 1_000_000_000f
                lastFrameNanos = frameTimeNanos
                currentPlayer.advance(deltaSeconds * currentPlayer.activeFps() * speed)
                renderSnapshot()
                Choreographer.getInstance().postFrameCallback(this)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        stageView = StateAnimView(this)
        statusView = TextView(this)
        speedView = TextView(this)
        playButton = Button(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(parseColorSafe("#E5E7EB"))
        }

        root.addView(stageView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ))
        root.addView(createOperationPanel())

        setContentView(root)
        loadPackage()
    }

    override fun onResume() {
        super.onResume()
        if (playing) {
            lastFrameNanos = 0L
            Choreographer.getInstance().postFrameCallback(frameCallback)
        }
    }

    override fun onPause() {
        super.onPause()
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        lastFrameNanos = 0L
    }

    private fun createOperationPanel(): LinearLayout {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(10))
            setBackgroundColor(parseColorSafe("#FFFFFF"))
        }

        panel.addView(TextView(this).apply {
            text = "State Anim Drive Android"
            textSize = 20f
            setTextColor(parseColorSafe("#0F172A"))
        })

        panel.addView(TextView(this).apply {
            text = "assets/state_anim_robot.zip"
            textSize = 12f
            setTextColor(parseColorSafe("#64748B"))
            setPadding(0, dp(2), 0, dp(8))
        })

        controlsPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
        }
        panel.addView(controlsPanel)

        playButton.text = "Pause"
        playButton.setOnClickListener {
            playing = !playing
            playButton.text = if (playing) "Pause" else "Play"
            if (playing) {
                lastFrameNanos = 0L
                Choreographer.getInstance().postFrameCallback(frameCallback)
            }
        }

        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        buttonRow.addView(playButton, rowButtonParams())
        buttonRow.addView(Button(this).apply {
            text = "Step"
            setOnClickListener {
                player?.advance(1f)
                renderSnapshot()
            }
        }, rowButtonParams())
        buttonRow.addView(Button(this).apply {
            text = "Reset"
            setOnClickListener {
                player?.reset()
                renderSnapshot()
            }
        }, rowButtonParams())
        buttonRow.addView(Button(this).apply {
            text = "Interrupt"
            setOnClickListener {
                player?.triggerInterrupt()
                renderSnapshot()
            }
        }, rowButtonParams())
        controlsPanel.addView(buttonRow)

        val speedRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        speedRow.addView(TextView(this).apply {
            text = "Speed"
            setTextColor(parseColorSafe("#334155"))
            textSize = 13f
        }, LinearLayout.LayoutParams(dp(58), LinearLayout.LayoutParams.WRAP_CONTENT))
        speedRow.addView(SeekBar(this).apply {
            max = 29
            progress = 9
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    speed = (progress + 1) / 10f
                    speedView.text = "${"%.1f".format(speed)}x"
                }

                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            })
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        speedRow.addView(speedView.apply {
            text = "1.0x"
            setTextColor(parseColorSafe("#334155"))
            gravity = Gravity.END
        }, LinearLayout.LayoutParams(dp(54), LinearLayout.LayoutParams.WRAP_CONTENT))
        controlsPanel.addView(speedRow)

        panel.addView(statusView.apply {
            setTextColor(parseColorSafe("#111827"))
            textSize = 13f
            setPadding(0, dp(8), 0, 0)
        })

        return panel
    }

    private fun loadPackage() {
        try {
            val loadedPackage = StateAnimLoader(this).load()
            runtimePackage = loadedPackage
            player = StateAnimPlayer(loadedPackage)
            stageView.runtimePackage = loadedPackage
            installParameterControls(loadedPackage)
            renderSnapshot()
            Choreographer.getInstance().postFrameCallback(frameCallback)
        } catch (error: Throwable) {
            statusView.text = "加载失败: ${error.message}"
            playing = false
            playButton.text = "Play"
        }
    }

    private fun installParameterControls(loadedPackage: StateAnimPackage) {
        optionButtons.clear()
        val moodParam = loadedPackage.machine.params.firstOrNull { it.name == "状态切换" }
        val themeParam = loadedPackage.machine.params.firstOrNull { it.name == "主题切换" }

        if (moodParam != null && moodParam.enumOptions.isNotEmpty()) {
            controlsPanel.addView(createOptionListRow("状态", moodParam, moodParam.defaultValue.toString()) { selected ->
                player?.setParam(moodParam.name, selected)
                updateOptionButtons(moodParam.name, selected)
                renderSnapshot()
            })
        }

        if (themeParam != null && themeParam.enumOptions.isNotEmpty()) {
            controlsPanel.addView(createOptionListRow("主题", themeParam, themeParam.defaultValue.toString()) { selected ->
                player?.setParam(themeParam.name, selected)
                updateOptionButtons(themeParam.name, selected)
                renderSnapshot()
            })
        }
    }

    private fun createOptionListRow(
        label: String,
        param: MachineParam,
        selected: String,
        onSelected: (String) -> Unit
    ): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }

        row.addView(TextView(this).apply {
            text = label
            setTextColor(parseColorSafe("#334155"))
            textSize = 13f
        }, LinearLayout.LayoutParams(dp(58), LinearLayout.LayoutParams.WRAP_CONTENT))

        val list = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        val buttons = mutableListOf<Button>()
        param.enumOptions.forEach { option ->
            val button = Button(this).apply {
                text = option
                textSize = 12f
                minHeight = dp(34)
                minWidth = 0
                setPadding(dp(10), 0, dp(10), 0)
                setOnClickListener { onSelected(option) }
            }
            buttons += button
            list.addView(button, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                dp(38)
            ).apply {
                marginEnd = dp(6)
            })
        }
        optionButtons[param.name] = buttons
        updateOptionButtons(param.name, selected)

        val scroller = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            overScrollMode = HorizontalScrollView.OVER_SCROLL_IF_CONTENT_SCROLLS
            addView(list)
        }

        row.addView(scroller, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        return row
    }

    private fun updateOptionButtons(paramName: String, selected: String) {
        optionButtons[paramName]?.forEach { button ->
            val active = button.text == selected
            button.isSelected = active
            button.setTextColor(parseColorSafe(if (active) "#FFFFFF" else "#0F172A"))
            button.setBackgroundColor(parseColorSafe(if (active) "#0EA5E9" else "#E2E8F0"))
        }
    }

    private fun renderSnapshot() {
        val snapshot = player?.snapshot() ?: return
        stageView.snapshot = snapshot
        statusView.text = snapshot.status
    }

    private fun rowButtonParams(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginEnd = dp(6)
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
