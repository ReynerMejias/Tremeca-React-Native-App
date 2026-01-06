import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

export const takePhoto = async () => {
  // 1. Solicitar permiso
  const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
  if (permissionResult.granted === false) {
    alert("Es necesario conceder permisos para usar la cámara");
    return;
  }

  // 2. Tomar la foto (SIN allowsEditing para evitar que el OS infle el archivo)
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: false, // ⚠️ IMPORTANTE: En false es mucho más rápido y respeta la calidad
    quality: 0.5,         // Calidad base
  });

  if (!result.canceled && result.assets && result.assets.length > 0) {
    try {
      // 3. LA MAGIA: Redimensionar a 800px de ancho (aprox calidad HD ligera)
      // Esto baja el peso de ~3MB a ~60KB sin perder legibilidad en los números.
      const manipResult = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 800 } }], // Mantiene la altura proporcionalmente
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG }
      );
      
      return manipResult.uri;
    } catch (error) {
      console.log("Error optimizando imagen, enviando original:", error);
      // Si falla la manipulación, mandamos la original como respaldo
      return result.assets[0].uri;
    }
  }

  return null;
};
