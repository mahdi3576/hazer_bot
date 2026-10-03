package com.hazer.bot

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import kotlin.math.abs
import android.webkit.WebViewClient
import android.widget.Button
import android.content.res.ColorStateList
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast

@Suppress("DEPRECATION")
class MainActivity : Activity() {

    private lateinit var web: PanWebView
    private lateinit var script: String
    private lateinit var btnRubika: Button
    private lateinit var btnShad: Button
    private lateinit var zoomBar: SeekBar
    private var baseScale = 0f
    private var alertId = 100
    private val handler = Handler(Looper.getMainLooper())

    // نگهبان: اگر صفحه خالی یا خطا شد، دوباره بارگذاری می‌کند
    private val watchdog = object : Runnable {
        override fun run() {
            val u = web.url
            if (u == null || u.startsWith("chrome-error") || u.startsWith("about:")) {
                val last = getSharedPreferences("hazer", Context.MODE_PRIVATE).getString("site", RUBIKA) ?: RUBIKA
                web.loadUrl(last)
            }
            handler.postDelayed(this, 45000)
        }
    }

    // پل بین اسکریپت داخل صفحه و برنامه (اعلان بعد از زدن «حاضر»)
    inner class Bridge {
        @JavascriptInterface
        fun notify(title: String, text: String) {
            runOnUiThread { showAlert(title, text) }
        }
    }

    private fun showAlert(title: String, text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel("hazer_alerts", "اعلان حاضر", NotificationManager.IMPORTANCE_HIGH)
            ch.enableVibration(true)
            ch.vibrationPattern = longArrayOf(0, 300, 150, 300)
            nm.createNotificationChannel(ch)
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "hazer_alerts")
        else Notification.Builder(this)
        val n = b.setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        nm.notify(alertId++, n)
    }

    companion object {
        const val RUBIKA = "https://web.rubika.ir/"
        const val SHAD = "https://web.shad.ir/"

        // مرورگر دسکتاپ، تا سایت نسخه کامل (لیست چت‌ها کنار گفتگو) را نشان بدهد
        const val DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Safari/537.36"

        const val PAGE_WIDTH = 1100

        // عرض ثابت ۱۱۰۰ (تا لیست چت‌ها کنار گفتگو بماند) و زوم آزاد با دو انگشت
        const val VIEWPORT_JS =
            "(function(){var m=document.querySelector('meta[name=viewport]');" +
                "if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}" +
                "m.setAttribute('content','width=1100, user-scalable=yes, minimum-scale=0.1, maximum-scale=10');})();"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        script = assets.open("hazer.js").bufferedReader().use { it.readText() }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0A2124.toInt())
        }
        val d = resources.displayMetrics.density
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xFF0F2E32.toInt())
            gravity = Gravity.CENTER_VERTICAL
            setPadding((6 * d).toInt(), (6 * d).toInt(), (6 * d).toInt(), (6 * d).toInt())
        }
        fun addButton(label: String, action: () -> Unit): Button {
            val b = Button(this).apply {
                text = label
                transformationMethod = null
                textSize = 15f
                setTextColor(0xFF9CBAB4.toInt())
                setBackgroundColor(0x00000000)
                setOnClickListener { action() }
            }
            val lp = LinearLayout.LayoutParams(0, (44 * d).toInt(), 1f)
            lp.setMargins((3 * d).toInt(), 0, (3 * d).toInt(), 0)
            bar.addView(b, lp)
            return b
        }
        btnRubika = addButton("روبیکا") { openSite(RUBIKA) }
        btnShad = addButton("شاد") { openSite(SHAD) }
        addButton("↻") { web.reload() }
        addButton("باتری") { askBatteryException() }
        root.addView(
            bar,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )

        // نوار زوم
        val zoomRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xFF0F2E32.toInt())
            gravity = Gravity.CENTER_VERTICAL
            setPadding((14 * d).toInt(), 0, (14 * d).toInt(), (4 * d).toInt())
        }
        zoomRow.addView(TextView(this).apply { text = "🔍"; textSize = 16f })
        zoomBar = SeekBar(this).apply {
            max = 100
            progress = 0
            progressTintList = ColorStateList.valueOf(0xFFFFC93C.toInt())
            thumbTintList = ColorStateList.valueOf(0xFFFFE48F.toInt())
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
                    if (!fromUser || baseScale <= 0f) return
                    val target = baseScale * (0.8f + 3.2f * p / 100f)
                    val cur = web.scale
                    if (cur > 0f) web.zoomBy((target / cur).coerceIn(0.2f, 5f))
                }
                override fun onStartTrackingTouch(sb: SeekBar?) {}
                override fun onStopTrackingTouch(sb: SeekBar?) {}
            })
        }
        zoomRow.addView(zoomBar, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val panBtn = TextView(this).apply {
            textSize = 18f
            setPadding((10 * d).toInt(), (6 * d).toInt(), (4 * d).toInt(), (6 * d).toInt())
        }
        fun paintPan() {
            panBtn.text = "✥"
            panBtn.setTextColor(if (web.panMode) 0xFF4EE3A0.toInt() else 0xFF6F8E88.toInt())
        }
        panBtn.setOnClickListener {
            web.panMode = !web.panMode
            getSharedPreferences("hazer", Context.MODE_PRIVATE).edit().putBoolean("pan", web.panMode).apply()
            paintPan()
            Toast.makeText(
                this,
                if (web.panMode) "کشیدن با یک انگشت: جابه‌جایی صفحه (وقتی زوم است)"
                else "کشیدن با یک انگشت: اسکرول داخل خود سایت",
                Toast.LENGTH_SHORT
            ).show()
        }
        zoomRow.addView(panBtn)
        root.addView(
            zoomRow,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )

        web = PanWebView(this)
        web.panMode = getSharedPreferences("hazer", Context.MODE_PRIVATE).getBoolean("pan", true)
        web.zoomedCheck = { baseScale > 0f && web.scale > baseScale * 1.08f }
        paintPan()
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            userAgentString = DESKTOP_UA
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        WebView.setWebContentsDebuggingEnabled(true)
        web.addJavascriptInterface(Bridge(), "HazerNative")

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null && (url.contains("rubika.ir") || url.contains("shad.ir"))) {
                    view?.evaluateJavascript(VIEWPORT_JS, null)
                    view?.evaluateJavascript(script, null)
                    baseScale = 0f
                    view?.postDelayed({
                            baseScale = web.scale
                        zoomBar.progress = ((1f - 0.8f) / 3.2f * 100f).toInt()
                    }, 1500)
                }
            }

            // وقتی با دو انگشت زوم می‌کنی، نوار هم جابه‌جا می‌شود
            override fun onScaleChanged(view: WebView?, oldScale: Float, newScale: Float) {
                super.onScaleChanged(view, oldScale, newScale)
                if (baseScale > 0f) {
                    val m = newScale / baseScale
                    zoomBar.progress = ((m - 0.8f) / 3.2f * 100f).toInt().coerceIn(0, 100)
                }
            }

            // اگر اینترنت قطع بود، چند ثانیه بعد دوباره تلاش می‌کند
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    web.postDelayed({ web.reload() }, 8000)
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                false
        }

        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        val svc = Intent(this, KeepAliveService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc) else startService(svc)

        val last = getSharedPreferences("hazer", Context.MODE_PRIVATE).getString("site", RUBIKA) ?: RUBIKA
        updateTabs(last)
        web.loadUrl(last)
        handler.postDelayed(watchdog, 45000)
    }

    private fun openSite(url: String) {
        getSharedPreferences("hazer", Context.MODE_PRIVATE).edit().putString("site", url).apply()
        updateTabs(url)
        web.loadUrl(url)
    }

    private fun styleTab(b: Button, active: Boolean) {
        b.setTextColor(if (active) 0xFFFFFFFF.toInt() else 0xFF9CBAB4.toInt())
        b.background = GradientDrawable().apply {
            cornerRadius = 100f
            setColor(if (active) 0x66FFC93C.toInt() else 0x00000000)
        }
    }

    private fun updateTabs(url: String) {
        styleTab(btnRubika, url == RUBIKA)
        styleTab(btnShad, url == SHAD)
    }

    private fun askBatteryException() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isIgnoringBatteryOptimizations(packageName)) {
            Toast.makeText(this, "قبلاً اجازه داده شده ✓", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
            )
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        moveTaskToBack(true) // با دکمه برگشت برنامه بسته نشود
    }

    override fun onDestroy() {
        handler.removeCallbacks(watchdog)
        stopService(Intent(this, KeepAliveService::class.java))
        web.destroy()
        super.onDestroy()
    }
}

/**
 * وقتی صفحه زوم است، کشیدن با یک انگشت خود صفحه را جابه‌جا می‌کند (حتی اگر سایت جلوی لمس را گرفته باشد).
 * زوم با دو انگشت مثل قبل است. لمس ساده (تپ) به سایت می‌رسد.
 */
@Suppress("DEPRECATION")
class PanWebView(context: Context) : WebView(context) {
    var panMode = true
    var zoomedCheck: () -> Boolean = { false }

    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downEv: MotionEvent? = null
    private var forwarded = false
    private var panning = false
    private var lx = 0f
    private var ly = 0f
    private var sx = 0f
    private var sy = 0f

    override fun onTouchEvent(e: MotionEvent): Boolean {
        val act = e.actionMasked
        if (act == MotionEvent.ACTION_DOWN) {
            downEv?.recycle()
            downEv = MotionEvent.obtain(e)
            panning = false
            lx = e.x; ly = e.y; sx = e.x; sy = e.y
            forwarded = !(panMode && zoomedCheck())
            return if (forwarded) super.onTouchEvent(e) else true
        }
        if (forwarded) {
            val r = super.onTouchEvent(e)
            if (act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) forwarded = false
            return r
        }
        when (act) {
            MotionEvent.ACTION_POINTER_DOWN -> {
                // انگشت دوم آمد: زوم با دو انگشت را به خود WebView بده
                downEv?.let { super.onTouchEvent(it) }
                forwarded = true
                return super.onTouchEvent(e)
            }
            MotionEvent.ACTION_MOVE -> {
                if (!panning && (abs(e.x - sx) > slop || abs(e.y - sy) > slop)) panning = true
                if (panning) {
                    scrollBy((lx - e.x).toInt(), (ly - e.y).toInt())
                    lx = e.x; ly = e.y
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (!panning) {
                    // تپ ساده: به سایت برسان
                    downEv?.let { super.onTouchEvent(it) }
                    return super.onTouchEvent(e)
                }
                return true
            }
        }
        return true
    }
}
