import React, { useEffect, useState, useCallback, useRef } from "react";
import { View, Image, ScrollView, TouchableOpacity, Modal, Text as RNText, PanResponder, Dimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Button,
  TextInput,
  Divider,
  Appbar,
  Text,
  useTheme,
  Portal,
  Dialog,
  ActivityIndicator,
  Card,
  Avatar,
  Banner,
  IconButton,
  Snackbar,
  List,
} from "react-native-paper";
import {
  postLectura,
  getCliente,
  patchLectura,
  getSolicitudAbiertaPorCliente,
} from "../api";
import { useRoute, useFocusEffect } from "@react-navigation/native";
import { getFecha, getFechaVencimiento } from "../utils/dateUtils";
import { takePhoto } from "../utils/imageUtils";
import ViewShot from "react-native-view-shot";
import { ensureBtReady, getWidthDots, printTicketZPL } from "../utils/zplPrinter";


function buildZplFields({
  cliente,
  lugar,
  completada,
  clienteUltimaLecturaAnterior,
  clienteUltimaLectura,
  lectura,
  multa,
}) {
  const fechaStr = getFecha(cliente, completada, lugar);
  const venceStr = getFechaVencimiento(cliente, completada, lugar);

  const lectAntStr = String(clienteUltimaLecturaAnterior ?? 0);
  const lectActStr = String(
    completada ? (clienteUltimaLectura ?? 0) : (parseInt(lectura || "0", 10) || 0)
  );
  const consumoStr = String(
    Math.max(
      0,
      (parseInt(lectActStr, 10) || 0) - (parseInt(lectAntStr, 10) || 0)
    )
  );

  const tarifaNum = Number(lugar?.valor || 0);
  const tarifaStr = `CRC ${Math.round(tarifaNum).toLocaleString("es-CR")}`;
  const subtotalNum = (parseInt(consumoStr, 10) || 0) * tarifaNum;

  const multaNum = completada
    ? Number(cliente?.ultima_lectura?.moratorio || 0)
    : Number(multa || 0);

  const subtotalStr = `CRC ${Math.round(subtotalNum).toLocaleString("es-CR")}`;
  const totalStr = `CRC ${Math.round(subtotalNum + multaNum).toLocaleString("es-CR")}`;

  const compStr = cliente?.ultima_lectura
    ? `#${cliente.ultima_lectura.fecha_lectura?.replace(/-/g, "")}${cliente.ultima_lectura.id}-${lugar?.codigo ?? ""}`
    : `#${new Date().toISOString().slice(0,10).replace(/-/g,"")}TEMP-${lugar?.codigo ?? ""}`;

  return {
    title: "Comprobante de lectura",
    comp: `Comprobante ${compStr}`,
    cliente: cliente?.nombre || "Cliente",
    lote: cliente?.lote || "",
    medidor: cliente?.medidor || "",
    sector: lugar?.codigo || "",
    fecha: fechaStr,
    vence: venceStr,
    lectAnt: lectAntStr,
    lectAct: lectActStr,
    consumo: consumoStr,
    tarifa: tarifaStr,
    subtotal: subtotalStr,
    total: totalStr,
    multa: multaNum > 0 ? `CRC ${Math.round(multaNum).toLocaleString("es-CR")}` : "CRC 0",
    despedida: "Recuerde pagar a tiempo. ¡Gracias!",
    tearOffset: -50, // ajusta si aún deja papel de más
  };
}

function SolicitudLecturaCardSession({
  visible = true,
  onClose,
  titulo = "Solicitud de lectura",
  motivo = "Cambiar lectura a 0",
  detalle = "",
  onIrASolicitud,
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (!visible) return null;

  return (
    <Card
      mode="outlined"
      style={{
        borderColor: colors.error,
        backgroundColor: colors.elevation?.level1 || colors.surface,
      }}
    >
      <Card.Title
        title={titulo}
        subtitle={motivo}
        left={(props) => <Avatar.Icon {...props} size={40} icon="alert" />}
        right={(props) => <IconButton {...props} icon="close" onPress={onClose} />}
      />
      {!!detalle && (
        <View style={{ padding: 16, paddingTop: 0 }}>
          <Text numberOfLines={expanded ? 40 : 3} style={{ opacity: 0.9 }}>
            {detalle}
          </Text>
          {detalle.length > 120 && (
            <Button
              onPress={() => setExpanded((e) => !e)}
              compact
              icon={expanded ? "chevron-up" : "chevron-down"}
              style={{ backgroundColor: colors.backdrop, fontSize: 12, marginTop: 4 }}
              textColor={colors.onPrimary}
            >
              {expanded ? "Ver menos" : "Ver más"}
            </Button>
          )}
        </View>
      )}
      {!!onIrASolicitud && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Button mode="outlined" icon="arrow-right" onPress={onIrASolicitud}>
            Ver solicitud
          </Button>
        </View>
      )}
    </Card>
  );
}

export default function Lectura({ navigation }) {
  const { colors } = useTheme();
  const route = useRoute();

  const raw = route.params?.clienteLugarCompletado;
  const compat = Array.isArray(raw)
    ? { cliente: raw[0], lugar: raw[1], completada: raw[2], index: 0, cacheKey: null, total: null }
    : null;

  const clienteInicial = route.params?.cliente ?? compat?.cliente;
  const lugar = route.params?.lugar ?? compat?.lugar;
  const completadaInicial = route.params?.completada ?? compat?.completada ?? false;
  const indexInicial = route.params?.index ?? 0;
  const cacheKey = route.params?.cacheKey ?? compat?.cacheKey;
  const total = route.params?.total ?? compat?.total;

  const [cliente, setCliente] = useState(clienteInicial);
  const [clienteUltimaLectura, setClienteUltimaLectura] = useState(0);
  const [clienteUltimaLecturaAnterior, setClienteUltimaLecturaAnterior] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [lectura, setLectura] = useState("");
  const [dialogIcon, setDialogIcon] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visible, setVisible] = useState(false);
  const [image, setImage] = useState(null);
  const [multa, setMulta] = useState("");
  const [multaDetalles, setMultaDetalles] = useState("");
  const [completada, setCompletada] = useState(completadaInicial);
  const [mostrarSolicitud, setMostrarSolicitud] = useState(true);
  const [solicitud, setSolicitud] = useState(null);
  const [cargandoSolicitud, setCargandoSolicitud] = useState(false);
  const [snack, setSnack] = useState({ visible: false, msg: "" });
  const [goNextAfterDialog, setGoNextAfterDialog] = useState(false);
  const [goNextOnlyPending, setGoNextOnlyPending] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(indexInicial);

  const [showCapture, setShowCapture] = useState(false);
  const ticketRef = useRef(null);
  const [shotWidth, setShotWidth] = useState(576);

  // --- LÓGICA DE GESTOS CON ACELERACIÓN ---
  const lecturaRef = useRef(0);
  const startValueRef = useRef(0);
  // Estado para feedback visual de "Turbo"
  const [isTurbo, setIsTurbo] = useState(false); 

  useEffect(() => {
    lecturaRef.current = parseInt(lectura || "0", 10) || 0;
  }, [lectura]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 40;
      },
      onPanResponderGrant: () => {
        startValueRef.current = lecturaRef.current;
        setIsTurbo(false);
      },
      onPanResponderMove: (_, gestureState) => {
        const dx = gestureState.dx;
        const absDx = Math.abs(dx);
        let change = 0;

        // --- FÓRMULA DE ACELERACIÓN ---
        // 1. Zona de Precisión (0 a 80px): Movimiento lineal lento (1 unidad cada 20px)
        if (absDx < 80) {
           change = Math.round(dx / 20);
           setIsTurbo(false);
        } 
        // 2. Zona Turbo (> 80px): Movimiento Exponencial
        else {
           setIsTurbo(true);
           const sign = Math.sign(dx);
           // Restamos los primeros 80px para calcular la "distancia turbo"
           const turboDist = absDx - 80; 
           
           // Fórmula exponencial: Eleva la distancia a la potencia 1.5 para saltos grandes
           // Esto permite ir de 0 a 150 muy rápido si arrastras lejos
           const turboBoost = Math.floor(Math.pow(turboDist, 1.5) / 10);
           
           // Base (4 unidades de la zona lenta) + Boost
           change = sign * (4 + turboBoost);
        }

        const newValue = Math.max(0, startValueRef.current + change);
        setLectura(String(newValue));
      },
      onPanResponderRelease: () => {
        setIsTurbo(false);
      },
    })
  ).current;
  // ----------------------------------------

  const mesHoy = new Date().getMonth() + 1;

  const AvatarLetter = ({ letter }) => <Avatar.Text size={45} label={letter} />;

  const numeroComprobante =
    cliente?.ultima_lectura
      ? `Comprobante #${cliente.ultima_lectura.fecha_lectura?.replace(/-/g, "")}${cliente.ultima_lectura.id} - ${lugar.codigo}`
      : "Comprobante sin lectura anterior";

  const isCompletadaMes = (c) => {
    if (!c?.ultima_lectura?.fecha_lectura) return false;
    
    const parts = c.ultima_lectura.fecha_lectura.split("-");
    const yearLectura = parseInt(parts[0], 10);
    const monthLectura = parseInt(parts[1], 10);
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    return yearLectura === currentYear && monthLectura === currentMonth;
  };

  const updateClienteEnCache = async (updated) => {
    if (!cacheKey) return;
    const raw = await AsyncStorage.getItem(cacheKey);
    if (!raw) return;
    const arr = JSON.parse(raw);
    const idx = arr.findIndex((x) => x.id === updated.id);
    if (idx >= 0) {
      arr[idx] = updated;
      await AsyncStorage.setItem(cacheKey, JSON.stringify(arr));
    }
  };

  const cargarClienteDeCachePorIndex = async (idx) => {
    if (!cacheKey) return null;
    const raw = await AsyncStorage.getItem(cacheKey);
    const arr = raw ? JSON.parse(raw) : [];
    if (idx < 0 || idx >= arr.length) return null;
    return arr[idx];
  };

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          setCargandoSolicitud(true);
          const s = await getSolicitudAbiertaPorCliente(cliente.id);
          if (alive) setSolicitud(s ?? null);
        } catch {
          if (alive) setSolicitud(null);
        } finally {
          if (alive) setCargandoSolicitud(false);
        }
      })();
      return () => {
        alive = false;
      };
    }, [cliente?.id])
  );

  const getEffectiveWidthPx = useCallback(async () => {
    const px = await getWidthDots(); 
    return Math.max(200, Math.floor((px || 576) / 8) * 8);
  }, []);

  useEffect(() => {
    if (!showCapture) return;
    let cancelled = false;
    (async () => {
      try {
        const widthPx = await getEffectiveWidthPx();
        setShotWidth(widthPx);
        await new Promise(r => setTimeout(r, 180));
        if (cancelled) return;

        const base64 = await ticketRef.current?.capture?.({
          format: "png",
          quality: 1,
          result: "base64",
          width: widthPx,
        });

        if (!base64 || base64.length < 5000) {
          setSnack({ visible: true, msg: "La captura salió vacía. Intenta de nuevo." });
        } else {
           setSnack({ visible: true, msg: `Imagen capturada (${widthPx}px).` });
        }
      } catch (e) {
        setSnack({ visible: true, msg: "No se pudo imprimir: " + (e?.message || e) });
      } finally {
        setShowCapture(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showCapture, getEffectiveWidthPx]);

  useEffect(() => {
    if (!cliente) return;
    if (cliente.ultima_lectura) {
      setClienteUltimaLectura(cliente.ultima_lectura.lectura);
      setClienteUltimaLecturaAnterior(cliente.ultima_lectura.lectura_anterior);
      setLectura(cliente.ultima_lectura.lectura?.toString() ?? "");
      if (completada && cliente.ultima_lectura.foto) {
        setImage(cliente.ultima_lectura.foto);
      }
      if (cliente.ultima_lectura.moratorio && completada) {
        setMulta(String(cliente.ultima_lectura.moratorio));
        setMultaDetalles(cliente.ultima_lectura.observacion || "");
      } else {
        setMulta("0");
        setMultaDetalles("");
      }
    } else {
      setClienteUltimaLectura(cliente.metros);
      setClienteUltimaLecturaAnterior(0);
      setLectura("");
      setImage(null);
      setMulta("0");
      setMultaDetalles("");
    }
  }, [cliente, completada]);

  useEffect(() => {
    setShowBanner(!(cliente?.correo && cliente?.correo !== ""));
  }, [cliente]);

  const handleInputChangeLectura = (text) => {
    const numericValue = text.replace(/[^0-9]/g, "");
    setLectura(numericValue);
  };

  const handleInputChangeMulta = (text) => {
    const numericValue = text.replace(/[^0-9]/g, "");
    setMulta(numericValue);
  };

  const handleSave = async () => {
    const validarLectura = completada ? clienteUltimaLecturaAnterior : clienteUltimaLectura;

    if (parseInt(lectura) < validarLectura) {
      setDialogIcon("alert");
      setTitle("Hubo un problema");
      setContent(
        completada
          ? "La lectura ingresada no puede ser menor que la anterior ya completada."
          : "La lectura ingresada no puede ser menor que la última lectura registrada."
      );
      setVisible(true);
      return;
    }

    try {
      setLoading(true);
      const formatDate = (date) => {
        const [day, month, year] = date.split("/");
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      };

      const data = new FormData();
      data.append("lectura", lectura);

      if (!completada) {
        data.append("cliente", cliente.id);
        data.append("fecha_lectura", formatDate(getFecha(cliente, completada, lugar)));
      }
      if (image) {
        data.append("foto", { uri: image, name: "foto.jpg", type: "image/jpg" });
      }
      const multaSan = String(multa ?? "").trim();
      const obsSan = String(multaDetalles ?? "");

      data.append("moratorio", multaSan === "" ? "0" : multaSan);
      data.append("observacion", obsSan);


      if (!completada) await postLectura(data);
      else await patchLectura(cliente.ultima_lectura.id, data);

      const clienteActualizado = await getCliente(cliente.id);
      setCliente(clienteActualizado);
      setCompletada(true);
      await updateClienteEnCache(clienteActualizado);

      setSnack({ visible: true, msg: "Guardado correctamente." });
      
      await irSiguiente(true);

    } catch (error) {
      setDialogIcon("alert");
      setTitle("Hubo un problema");
      setContent("Ocurrió un error al guardar la lectura. " + error);
      setVisible(true);
    } finally {
      setLoading(false);
    }
  };


  const handleSolicitud = (c) => navigation.navigate("Solicitud", { cliente: c });

  const irSiguiente = async (soloPendiente = false) => {
    if (!cacheKey) return;
    const raw = await AsyncStorage.getItem(cacheKey);
    const arr = raw ? JSON.parse(raw) : [];
    let j = currentIndex + 1;
    while (j < arr.length) {
      const c = arr[j];
      const comp = isCompletadaMes(c);
      if (!soloPendiente || !comp) break;
      j++;
    }
    if (j >= arr.length) {
      setSnack({ visible: true, msg: "Fin de la lista." });
      return;
    }
    setCurrentIndex(j);
    setCliente(arr[j]);
    setCompletada(isCompletadaMes(arr[j]));
    setImage(null);
  };

  const irAnterior = async () => {
    if (!cacheKey) return;
    const nextIdx = Math.max(0, currentIndex - 1);
    if (nextIdx === currentIndex) return;
    const c = await cargarClienteDeCachePorIndex(nextIdx);
    if (!c) return;
    setCurrentIndex(nextIdx);
    setCliente(c);
    setCompletada(isCompletadaMes(c));
    setImage(null);
  };

  const dineroCRC = (n) => `CRC ${Math.round(Number(n || 0)).toLocaleString("es-CR")}`;

  const handlePrintZPL = async () => {
    try {
      await ensureBtReady();
      await getWidthDots();

      const fechaStr = getFecha(cliente, completada, lugar);
      const venceStr = getFechaVencimiento(cliente, completada, lugar);

      const lectAntStr = String(clienteUltimaLecturaAnterior ?? 0);
      const lectActStr = String(
        completada ? (clienteUltimaLectura ?? 0) : (parseInt(lectura || "0", 10) || 0)
      );
      const consumoStr = String(
        Math.max(
          0,
          (parseInt(lectActStr, 10) || 0) - (parseInt(lectAntStr, 10) || 0)
        )
      );

      const tarifaStr = `CRC ${Math.round(Number(lugar?.valor || 0)).toLocaleString("es-CR")}`;
      const subtotalNum =
        (parseInt(consumoStr, 10) || 0) * Number(lugar?.valor || 0);
      const multaNum = completada
        ? Number(cliente?.ultima_lectura?.moratorio || 0)
        : Number(multa || 0);
      const obsStr = (completada ? (cliente?.ultima_lectura?.observacion || "") : (multaDetalles || "").trim()) || "";
      const subtotalStr = `CRC ${Math.round(subtotalNum).toLocaleString("es-CR")}`;
      const totalStr = `CRC ${Math.round(subtotalNum + multaNum).toLocaleString("es-CR")}`;

      const compStr = cliente?.ultima_lectura
        ? `#${cliente.ultima_lectura.fecha_lectura?.replace(/-/g, "")}${cliente.ultima_lectura.id}-${lugar?.codigo ?? ""}`
        : `#${new Date().toISOString().slice(0,10).replace(/-/g,"")}TEMP-${lugar?.codigo ?? ""}`;

      const fields = {
        title: "Comprobante de lectura",
        comp: `Comprobante ${compStr}`,
        cliente: cliente?.nombre || "Cliente",
        lote: cliente?.lote || "",
        medidor: cliente?.medidor || "",
        sector: lugar?.codigo || "",
        fecha: fechaStr,
        vence: venceStr,
        lectAnt: lectAntStr,
        lectAct: lectActStr,
        consumo: consumoStr,
        tarifa: tarifaStr.replace(/\s+/g, " "),
        subtotal: subtotalStr.replace(/\s+/g, " "),
        total: totalStr.replace(/\s+/g, " "),
        multa: multaNum > 0 ? `CRC ${Math.round(multaNum).toLocaleString("es-CR")}` : "CRC 0",
        obs: obsStr,
        despedida: "Recuerde pagar a tiempo. ¡Gracias!",
        tearOffset: -50,
      };

      await printTicketZPL(fields); 
      setSnack({ visible: true, msg: "Ticket ZPL enviado." });
    } catch (e) {
      setSnack({ visible: true, msg: "No se pudo imprimir: " + (e?.message || e) });
    }
  };


  const consumo = Math.max(
    0,
    (parseInt(String(completada ? clienteUltimaLectura : lectura || 0), 10) || 0) -
      (parseInt(String(clienteUltimaLecturaAnterior || 0), 10) || 0)
  );
  const subtotal = consumo * Number(lugar?.valor ?? 0);
  const multaUsar = completada
    ? Number(cliente?.ultima_lectura?.moratorio || 0)
    : Number(multa || 0);
  const obsUsar = completada
    ? (cliente?.ultima_lectura?.observacion || "")
    : (multaDetalles || "");
  const totalPagar = subtotal + multaUsar;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <Portal>
          <Dialog visible={visible} onDismiss={() => setVisible(false)}>
            <Dialog.Icon icon={dialogIcon} color={colors.error} />
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Content>
              <Text>{content}</Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button
                onPress={() => {
                  setVisible(false);
                  if (goNextAfterDialog) {
                    setGoNextAfterDialog(false);
                    irSiguiente(goNextOnlyPending);
                  }
                }}
              >
                OK
              </Button>
            </Dialog.Actions>
          </Dialog>
        </Portal>

        <Appbar.Header>
          <Appbar.BackAction onPress={() => navigation.goBack()} />
          <Appbar.Content
            title={
              completada && cliente?.ultima_lectura
                ? `${cliente.ultima_lectura.fecha_lectura?.replace(/-/g, "")}${cliente.ultima_lectura.id}-${lugar.codigo}`
                : "Crear lectura"
            }
            subtitle={total != null ? `Cliente ${currentIndex + 1} de ${total}` : undefined}
          />
          <Appbar.Action icon="chevron-left" onPress={irAnterior} disabled={currentIndex <= 0} />
          <Appbar.Action icon="chevron-right" onPress={() => irSiguiente(false)} />
          <Appbar.Action icon="fast-forward" onPress={() => irSiguiente(true)} />
          <Appbar.Action icon="comment-alert" onPress={() => handleSolicitud(cliente)} />
          <Appbar.Action icon="printer" onPress={handlePrintZPL} />

        </Appbar.Header>

        {showBanner && (
          <Banner
            visible={showBanner}
            actions={[
              {
                label: "Agregar correo",
                onPress: () =>
                  navigation.navigate("Correo", {
                    clienteLugarCompletado: [cliente, lugar, completada],
                  }),
              },
              { label: "Cerrar", onPress: () => setShowBanner(false) },
            ]}
            icon="information"
          >
            Este cliente no tiene correo registrado. Imprime el comprobante desde el botón arriba a la derecha.
          </Banner>
        )}

        <View style={{ padding: 16, gap: 16, flex: 1 }}>
          {loading && <ActivityIndicator />}

          <Card style={{ backgroundColor: colors.surface }} mode="outlined">
            <Card.Title
              title={cliente?.nombre}
              subtitle={cliente?.lote}
              left={() => <Avatar.Text size={45} label={cliente?.nombre?.[0] || "?"} />}
            />
            <Card.Content>
              <Text>Medidor: {cliente?.medidor}</Text>
              <Text style={{ marginBottom: 20 }}>Orden: {cliente?.orden}</Text>
              <Text>Fecha lectura: {getFecha(cliente, completada, lugar)}</Text>
              <Text>Fecha vencimiento: {getFechaVencimiento(cliente, completada, lugar)}</Text>
            </Card.Content>
          </Card>

          <Text style={{ fontSize: 16 }}>1. Lectura Actual</Text>
          <View style={{ gap: 4 }}>
            <TextInput
              mode="outlined"
              placeholder="Lectura"
              value={lectura}
              onChangeText={handleInputChangeLectura}
              keyboardType="numeric"
              inputMode="numeric"
              maxLength={6}
            />
            <Text style={{ fontSize: 14, color: colors.accent, fontStyle: "italic" }}>
              {completada
                ? `Lectura anterior: ${clienteUltimaLecturaAnterior}`
                : `Lectura anterior: ${clienteUltimaLectura}`}
            </Text>
          </View>

          <List.Accordion
             title="2. Fotografía (Opcional)"
             style={{ padding: 0, backgroundColor: 'transparent' }}
             titleStyle={{ fontSize: 16, color: colors.text }}
          >
            <View style={{ paddingTop: 8 }}>
              {image ? (
                <TouchableOpacity
                  onPress={async () => {
                    const photoUri = await takePhoto();
                    if (photoUri) setImage(photoUri);
                  }}
                >
                  <View style={{ position: "relative" }}>
                    <Image
                      source={{ uri: image }}
                      style={{
                        width: "100%",
                        height: 200,
                        borderRadius: 8,
                        borderColor: colors.accent,
                        borderWidth: 1,
                        opacity: 0.8,
                      }}
                    />
                    <Text
                      style={{
                        position: "absolute",
                        top: "40%",
                        alignSelf: "center",
                        color: colors.accent,
                        backgroundColor: "rgba(0, 0, 0, 0.5)",
                        padding: 10,
                        borderRadius: 10,
                      }}
                    >
                      Cambiar fotografía
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <Button
                  mode="outlined"
                  contentStyle={{ height: 200 }}
                  icon={"camera"}
                  textColor={colors.text}
                  style={{ width: "100%" }}
                  onPress={async () => {
                    const photoUri = await takePhoto();
                    if (photoUri) setImage(photoUri);
                  }}
                >
                  Tomar fotografía
                </Button>
              )}
            </View>
          </List.Accordion>
          
          <Divider />

          <List.Accordion
             title="3. Multa (Opcional)"
             style={{ padding: 0, backgroundColor: 'transparent' }}
             titleStyle={{ fontSize: 16, color: colors.text }}
          >
            <View style={{ paddingTop: 8, gap: 8 }}>
              <TextInput
                mode="outlined"
                placeholder="Monto de la multa"
                value={multa}
                onChangeText={handleInputChangeMulta}
                keyboardType="numeric"
                inputMode="numeric"
                maxLength={10}
              />
              <TextInput
                mode="outlined"
                placeholder="Detalles de la multa (opcional)"
                value={multaDetalles}
                onChangeText={setMultaDetalles}
                multiline
                numberOfLines={3}
                style={{ height: 80 }}
              />
            </View>
          </List.Accordion>
          
          <Divider style={{ marginBottom: 10 }}/>

          {cargandoSolicitud && (
            <ActivityIndicator animating style={{ alignSelf: "center" }} />
          )}
          {!!solicitud && (
            <>
              <SolicitudLecturaCardSession
                visible={mostrarSolicitud}
                onClose={() => setMostrarSolicitud(false)}
                onIrASolicitud={() => handleSolicitud(cliente)}
                titulo={"Solicitud de lectura"}
                motivo={solicitud?.titulo ?? "Solicitud"}
                detalle={solicitud?.descripcion ?? ""}
              />
              {!mostrarSolicitud && (
                <Button mode="text" icon="eye" onPress={() => setMostrarSolicitud(true)}>
                  Mostrar solicitud
                </Button>
              )}
            </>
          )}

          <View style={{ flex: 1 }} />

          {completada && (
            <View
              style={{
                padding: 10,
                backgroundColor: colors.surface,
                borderRadius: 12,
                borderColor: colors.accent,
                borderWidth: 1,
                borderStyle: "dashed",
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: "600", marginBottom: 4 }}>
                Detalles de consumo:
              </Text>
              <Divider style={{ marginBottom: 8, backgroundColor: colors.accent }} />
              <Text style={{ fontSize: 13, marginBottom: 2 }}>
                💧 Costo por m³: <Text style={{ fontWeight: "500" }}>{dineroCRC(lugar.valor)}</Text>
              </Text>
              <Text style={{ fontSize: 13, marginBottom: 2 }}>
                📏 Metros consumidos: <Text style={{ fontWeight: "500" }}>{consumo}</Text>
              </Text>
              <Text style={{ fontSize: 13, marginTop: 4 }}>
                💰 Total a pagar:{" "}
                <Text style={{ fontWeight: "bold", color: colors.primary }}>
                  {dineroCRC(totalPagar)}
                </Text>
              </Text>
            </View>
          )}

          {/* === ZONA DE CONTROL (THUMB ZONE ACELERADA) === */}
          <View 
            {...panResponder.panHandlers}
            style={{ 
              height: 120,
              backgroundColor: isTurbo ? colors.secondaryContainer : (colors.elevation?.level2 || '#f0f0f0'), 
              borderRadius: 16,
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: isTurbo ? 2 : 1,
              borderColor: isTurbo ? colors.primary : colors.outlineVariant,
              marginBottom: 8
            }}
          >
             <IconButton icon={isTurbo ? "run-fast" : "gesture-swipe-horizontal"} size={32} iconColor={isTurbo ? colors.primary : colors.outline} />
             <Text style={{ color: isTurbo ? colors.primary : colors.secondary, fontWeight: 'bold' }}>
               {isTurbo ? "¡TURBO ACTIVADO!" : "DESLIZA AQUÍ (SUAVE O RÁPIDO)"}
             </Text>
             <View style={{ flexDirection: 'row', width: '100%', justifyContent: 'space-between', paddingHorizontal: 20, position: 'absolute' }}>
                 <IconButton icon="chevron-double-left" size={24} iconColor={colors.outline} />
                 <IconButton icon="chevron-double-right" size={24} iconColor={colors.outline} />
             </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              gap: 8,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Button
              mode="contained"
              contentStyle={{ height: 58 }}
              icon={!completada ? "content-save" : "content-save-edit"}
              style={{
                backgroundColor: colors.primary,
                flex: 1,
              }}
              onPress={handleSave}
            >
              {!completada ? "Guardar" : "Editar lectura"}
            </Button>
          </View>
        </View>
      </ScrollView>

      <Modal visible={showCapture} transparent animationType="none">
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.02)", alignItems: "center", justifyContent: "center" }}>
          <View style={{ backgroundColor: "#fff" }}>
            <ViewShot ref={ticketRef} options={{ format: "png", quality: 1, result: "base64", width: shotWidth }}>
              <View collapsable={false} style={{ width: shotWidth, backgroundColor: "#ffffff", padding: 0 }}>
                {/* Encabezado */}
                <RNText style={{ color: "#000", textAlign: "center", fontWeight: "bold", fontSize: 28 }}>
                  Tremeca M&M S.A.
                </RNText>
                <RNText style={{ color: "#000", textAlign: "center", fontWeight: "bold", fontSize: 24 }}>
                  Comprobante de lectura
                </RNText>
                <RNText style={{ color: "#000", textAlign: "center", fontSize: 20 }}>
                  {numeroComprobante}
                </RNText>

                <View style={{ height: 4, backgroundColor: "#000", width: shotWidth, marginVertical: 8 }} />

                {/* Datos */}
                <View style={{ width: shotWidth }}>
                  <RNText style={{ color: "#000", fontSize: 20 }}>{cliente?.nombre ?? "Cliente"}</RNText>
                  {!!cliente?.lote && <RNText style={{ color: "#000", fontSize: 20 }}>Lote: {cliente.lote}</RNText>}
                  {!!cliente?.medidor && <RNText style={{ color: "#000", fontSize: 20 }}>Medidor: {cliente.medidor}</RNText>}
                  {!!lugar?.codigo && <RNText style={{ color: "#000", fontSize: 20 }}>Sector: {lugar.codigo}</RNText>}
                  <RNText style={{ color: "#000", fontSize: 20 }}>
                    Fecha: {getFecha(cliente, completada, lugar)}   Vence: {getFechaVencimiento(cliente, completada, lugar)}
                  </RNText>
                </View>

                <View style={{ height: 4, backgroundColor: "#000", width: shotWidth, marginVertical: 8 }} />

                {/* Lecturas */}
                <View style={{ width: shotWidth }}>
                  <RNText style={{ color: "#000", fontSize: 20 }}>Lect. ant.: {clienteUltimaLecturaAnterior}</RNText>
                  <RNText style={{ color: "#000", fontSize: 20 }}>
                    Lect. act.: {completada ? clienteUltimaLectura : (lectura || 0)}
                  </RNText>
                  <RNText style={{ color: "#000", fontSize: 20 }}>
                    Consumo (m³): {Math.max(0,
                      (parseInt(String(completada ? clienteUltimaLectura : lectura || 0), 10) || 0) -
                      (parseInt(String(clienteUltimaLecturaAnterior || 0), 10) || 0)
                    )}
                  </RNText>
                </View>

                <View style={{ height: 4, backgroundColor: "#000", width: shotWidth, marginVertical: 8 }} />

                {/* Totales */}
                <View style={{ width: shotWidth }}>
                  <RNText style={{ color: "#000", fontSize: 20 }}>
                    Tarifa x m³: CRC {Math.round(Number(lugar?.valor || 0)).toLocaleString("es-CR")}
                  </RNText>
                  <RNText style={{ color: "#000", fontSize: 20 }}>
                    Subtotal: CRC {Math.round(
                      Math.max(0,
                        (parseInt(String(completada ? clienteUltimaLectura : lectura || 0), 10) || 0) -
                        (parseInt(String(clienteUltimaLecturaAnterior || 0), 10) || 0)
                      ) * Number(lugar?.valor || 0)
                    ).toLocaleString("es-CR")}
                  </RNText>
                  {(completada ? Number(cliente?.ultima_lectura?.moratorio || 0) : Number(multa || 0)) > 0 && (
                    <RNText style={{ color: "#000", fontSize: 20 }}>
                      Multa: CRC {Math.round(completada
                        ? Number(cliente?.ultima_lectura?.moratorio || 0)
                        : Number(multa || 0)
                      ).toLocaleString("es-CR")}
                    </RNText>
                  )}
                  <RNText style={{ color: "#000", fontSize: 22, fontWeight: "bold" }}>
                    TOTAL: CRC {Math.round(
                      Math.max(0,
                        (parseInt(String(completada ? clienteUltimaLectura : lectura || 0), 10) || 0) -
                        (parseInt(String(clienteUltimaLecturaAnterior || 0), 10) || 0)
                      ) * Number(lugar?.valor || 0) +
                      (completada ? Number(cliente?.ultima_lectura?.moratorio || 0) : Number(multa || 0))
                    ).toLocaleString("es-CR")}
                  </RNText>
                  {(completada ? (cliente?.ultima_lectura?.observacion || "") : (multaDetalles || "")) ? (
                    <RNText style={{ color: "#000", fontSize: 18, marginTop: 8 }}>
                      Obs: {completada ? (cliente?.ultima_lectura?.observacion || "") : (multaDetalles || "")}
                    </RNText>
                  ) : null}
                </View>

                <RNText style={{ color: "#000", textAlign: "center", fontSize: 20, marginTop: 12 }}>
                  Gracias por su pago.
                </RNText>
              </View>
            </ViewShot>
          </View>
        </View>
      </Modal>

      <Snackbar
        visible={snack.visible}
        onDismiss={() => setSnack({ visible: false, msg: "" })}
        duration={2500}
      >
        {snack.msg}
      </Snackbar>
    </View>
  );
}
