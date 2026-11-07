# Validación de Android

[English](VERIFICATION.md) · [简体中文](VERIFICATION.zh.md) · [繁體中文](VERIFICATION.zh-Hant.md) · [日本語](VERIFICATION.ja.md) · [한국어](VERIFICATION.ko.md) · [Français](VERIFICATION.fr.md) · [Español](VERIFICATION.es.md)

Versión actual del código: 0.1.10 / código de versión 11. Herramientas: JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3, Kotlin 2.0.21, SDK 35 y Build Tools 35.0.0.

## Reproducir

Desde la raíz del repositorio, indica el SDK instalado con `ANDROID_HOME` o el archivo ignorado `android/local.properties`:

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

En macOS/Linux usa `sh android/gradlew -p android` con las mismas tareas. El wrapper fija Gradle 8.9 y verifica su suma de comprobación. El segundo comando necesita emulador o dispositivo. Las pruebas usan HTTP integrado y audio sintético, sin servidor de producción, credenciales ni música personal.

Salidas estándar bajo `android/app/build/`:

- `reports/tests/testDebugUnitTest/` y `test-results/testDebugUnitTest/`: informes JVM.
- `reports/lint-results-debug.html` y `.xml`: diagnósticos lint.
- `reports/androidTests/` y `outputs/androidTest-results/`: informes de dispositivo.
- `outputs/apk/debug/app-debug.apk`: APK de desarrollo.
- `outputs/apk/release/app-release-unsigned.apk`: APK reducido que necesita firma de publicación.

El [workflow Android](../.github/workflows/android.yml) compila Debug y Release, ejecuta JVM/lint y un trabajo independiente de emulador API 35. Sube APK, informes y capturas como artefactos CI. Las capturas documentales seleccionadas se incluyen en `docs/images/`; las salidas completas y evidencias locales quedan fuera del control de versiones.

## Resultados registrados

La comprobación de publicación de fuentes del 2026-11-07 completó `testDebugUnitTest lintDebug assembleDebug assembleRelease` con Gradle 8.9 y JDK 17. Reutilizó salidas incrementales existentes: 2 tareas ejecutadas y 97 actualizadas. El wrapper no terminó de descargar la distribución durante la comprobación de red local, por lo que se utilizó Gradle 8.9 ya instalado. Un script local de inicialización seleccionó un directorio de salida existente; código y tareas procedían de este repositorio.

Los informes reutilizados contienen 29 pruebas JVM sin fallos, errores ni omisiones. Lint tiene cero errores, 15 advertencias y una información. Existen los APK de desarrollo y release reducido sin firmar. Son resultados incrementales, no una ejecución nueva de emulador ni una compilación limpia independiente.

La validación anterior del 2026-11-05 registró 22 pruebas de dispositivo correctas en un emulador Android 15 / API 35 x86_64, de 945 × 1680 píxeles y 420 dpi. También verificó la firma del APK de desarrollo. Cubre navegación nativa, reproducción y búsqueda temporal, cola, descargas/uso sin conexión, aislamiento de caché, precarga siguiente y regresión de barra plegable.

La regresión de barra muestrea estados parcialmente plegados, varias combinaciones de densidad/escala de fuente y márgenes de estado; después verifica plegado completo, restauración y cambios de densidad. Comprueba los fragmentos de título/iconos corregidos en 0.1.10. Los avisos lint existentes se refieren a dependencias, escrituras síncronas de preferencias, servicio multimedia exportado, referencia al repositorio con alcance de aplicación y estado entero encapsulado en la interfaz de importación.

## Límites de cobertura

La actualización documental del 2026-11-07 no ejecutó nuevas pruebas en emulador ni dispositivo físico. Siguen sin verificarse Android 8 en ejecución, Android 16 y comportamiento de fabricantes, integración de batería/auriculares y cuentas de almacenamiento de producción. También se conoce una carrera de Stop tardío en Android 15 después de vaciar y reiniciar inmediatamente la cola.

Consulta la [guía Android](README.es.md#límites-actuales) para límites de códecs, subidas en primer plano y administración avanzada. Las firmas y sumas de los APK locales y CI pueden diferir; verifica el artefacto de la ejecución que vayas a instalar.
