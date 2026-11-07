# Serialization generates adapters referenced by the companion object.
-keepattributes Signature,InnerClasses,EnclosingMethod
-keepclassmembers class **$Companion { kotlinx.serialization.KSerializer serializer(...); }
