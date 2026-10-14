# JavaScript bridge methods are called by name from the web page.
-keepclassmembers class rentals.eqal.rentroll.WebBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
