import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  ScrollView,
  TouchableWithoutFeedback,
  Text,
  StatusBar,
  Platform,
} from "react-native";
import {
  Appbar,
  Card,
  Avatar,
  useTheme,
  ActivityIndicator,
  Searchbar,
  Chip,
} from "react-native-paper";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import { getClientes } from "../api";

export default function Clientes({ navigation }) {
  const { colors } = useTheme();
  const AvatarLetter = ({ letter }) => <Avatar.Text size={45} label={letter} />;
  const AvatarCheck = (props) => <Avatar.Icon {...props} size={45} icon="check" />;

  const [Clientes, setClientes] = useState([]);
  const [filteredClientes, setFilteredClientes] = useState([]);
  const [search, setSearch] = useState("");
  const route = useRoute();
  const { lugar } = route.params;
  const [loading, setLoading] = useState(true);
  const [mostrarCompletados, setMostrarCompletados] = useState(true);
  const [lastSync, setLastSync] = useState(0);

  const mesHoy = new Date().getMonth() + 1;
  const CACHE_KEY = useMemo(
    () => `clientes_${lugar?.id ?? lugar?.nombre}`,
    [lugar?.id, lugar?.nombre]
  );
  const SYNC_KEY = `${CACHE_KEY}_lastSync`;

  const statusBarHeight =
    Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0;

  const formatAgo = (ts) => {
    if (!ts) return "nunca";
    const diff = Math.max(0, Date.now() - Number(ts));
    const m = Math.floor(diff / 60000);
    if (m < 1) return "justo ahora";
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h`;
    const d = Math.floor(h / 24);
    return `${d} d`;
  };

  // 🔴 CORREGIDO: Ahora valida AÑO y MES para evitar falsos positivos con lecturas del año pasado
  const isCompletadaMes = (cliente) => {
    if (!cliente?.ultima_lectura?.fecha_lectura) return false;
    
    const parts = cliente.ultima_lectura.fecha_lectura.split("-");
    const yearLectura = parseInt(parts[0], 10);
    const monthLectura = parseInt(parts[1], 10);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Devuelve true solo si el año Y el mes coinciden exactamente
    return yearLectura === currentYear && monthLectura === currentMonth;
  };

  const aplicarFiltro = (lista, term) => {
    if (!term?.trim()) return lista;
    const t = term.toLowerCase();
    return lista.filter(
      (c) =>
        c.nombre.toLowerCase().includes(t) ||
        c.medidor.toString().includes(term) ||
        c.lote.toLowerCase().includes(t)
    );
  };

  const leerCache = async () => {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const rawSync = await AsyncStorage.getItem(SYNC_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    setLastSync(rawSync ? Number(rawSync) : 0);
    return arr;
  };

  const guardarCache = async (arr) => {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(arr));
    const now = Date.now().toString();
    await AsyncStorage.setItem(SYNC_KEY, now);
    setLastSync(Number(now));
  };

  const cargarDesdeCachePrimero = async () => {
    setLoading(true);
    try {
      const cached = await leerCache();
      if (cached.length) {
        setClientes(cached);
        setFilteredClientes(aplicarFiltro(cached, search));
        setLoading(false);
      } else {
        await recargarOnline();
      }
    } catch (e) {
      console.error("cargarDesdeCachePrimero", e);
      await recargarOnline();
    } finally {
      setLoading(false);
    }
  };

  const recargarOnline = async () => {
    try {
      setLoading(true);
      const data = await getClientes(lugar.nombre);
      await guardarCache(data);
      setClientes(data);
      setFilteredClientes(aplicarFiltro(data, search));
    } catch (error) {
      console.error("recargarOnline", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cargarPreferencia = async () => {
      const valorGuardado = await AsyncStorage.getItem("mostrarCompletados");
      if (valorGuardado !== null) setMostrarCompletados(valorGuardado === "true");
    };
    cargarPreferencia();
  }, []);

  useEffect(() => {
    cargarDesdeCachePrimero();
  }, [CACHE_KEY]);

  useFocusEffect(
    useCallback(() => {
      // Al volver de Lectura, solo leer el cache (sin pedir al servidor)
      (async () => {
        const cached = await leerCache();
        if (cached.length) {
          setClientes(cached);
          setFilteredClientes(aplicarFiltro(cached, search));
          setLoading(false);
        }
      })();
    }, [CACHE_KEY, search])
  );

  useEffect(() => {
    setFilteredClientes(aplicarFiltro(Clientes, search));
  }, [search, Clientes]);

  const toggleMostrarCompletados = async () => {
    const nuevoEstado = !mostrarCompletados;
    setMostrarCompletados(nuevoEstado);
    await AsyncStorage.setItem("mostrarCompletados", nuevoEstado.toString());
  };

  const handleCardPress = (cliente, index) => {
    const completada = isCompletadaMes(cliente);
    navigation.navigate("Lectura", {
      cliente,
      lugar,
      completada,
      index,
      cacheKey: CACHE_KEY,
      total: filteredClientes.length,
    });
  };

  let clientesCompletados = filteredClientes.filter(isCompletadaMes).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Appbar.Header>
        <Appbar.BackAction onPress={() => navigation.goBack()} />
        <Appbar.Content
          title={loading ? "Cargando..." : lugar.nombre}
          subtitle={`Últ. sync: ${formatAgo(lastSync)}`}
        />
        <Appbar.Action
          icon={mostrarCompletados ? "bookmark-check" : "bookmark-check-outline"}
          onPress={toggleMostrarCompletados}
          accessibilityLabel="Mostrar/Ocultar completados"
        />
        <Appbar.Action
          icon="cloud-refresh"
          onPress={recargarOnline}
          accessibilityLabel="Recargar desde servidor"
        />
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Searchbar
          placeholder="Buscar cliente..."
          value={search}
          onChangeText={setSearch}
          style={{ marginBottom: 10 }}
        />

        {!loading && filteredClientes.length > 0 && (
          <View
            style={{
              marginBottom: 16,
              padding: 12,
              backgroundColor: colors.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.primary,
              elevation: 2,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}>
              Estado de lecturas
            </Text>
            <Text style={{ color: colors.text, fontSize: 14, marginTop: 4 }}>
              {clientesCompletados} de {filteredClientes.length} clientes ya han
              registrado su lectura este mes.
            </Text>

            <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <Chip icon="check" compact>
                Completados: {clientesCompletados}
              </Chip>
              <Chip icon="progress-clock" compact>
                Pendientes: {filteredClientes.length - clientesCompletados}
              </Chip>
            </View>
          </View>
        )}

        {loading ? (
          <ActivityIndicator />
        ) : filteredClientes.length === 0 ? (
          <Text style={{ color: colors.text, textAlign: "center" }}>
            No hay clientes en este lugar.
          </Text>
        ) : (
          filteredClientes.map((cliente, index) => {
            const completada = isCompletadaMes(cliente);
            if (!mostrarCompletados && completada) return null;

            return (
              <TouchableWithoutFeedback
                key={cliente.id ?? index}
                onPress={() => handleCardPress(cliente, index)}
              >
                <Card
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: completada ? 2 : 0,
                    borderColor: completada ? colors.primary : "transparent",
                    marginBottom: 10,
                  }}
                >
                  <Card.Title
                    title={`${cliente.nombre} "${cliente.lote}"`}
                    subtitle={
                      cliente.ultima_lectura
                        ? `Medidor: ${cliente.medidor} (últ.: ${cliente.ultima_lectura.lectura})`
                        : `Medidor: ${cliente.medidor} (últ.: ${cliente.metros})`
                    }
                    left={() =>
                      completada ? <AvatarCheck /> : <AvatarLetter letter={cliente.nombre[0]} />
                    }
                  />
                  {completada && (
                    <Card.Content>
                      <Text
                        style={{
                          color: colors.primary,
                          fontStyle: "italic",
                          textAlign: "right",
                        }}
                      >
                        Completado
                      </Text>
                    </Card.Content>
                  )}
                </Card>
              </TouchableWithoutFeedback>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
