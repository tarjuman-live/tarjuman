import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { LANGUAGES } from "@shared/constants";
import { langName } from "~/lib/lang";
import { C, RADIUS } from "~/lib/theme";


interface Props {
  source: string;
  target: string;
  onChange: (next: { source: string; target: string }) => void;
  disabled?: boolean;
}

/** Source ⇄ target pills; each opens a searchable sheet (web: bottom sheet). */
export function LanguagePicker({ source, target, onChange, disabled }: Props) {
  const [open, setOpen] = useState<null | "source" | "target">(null);

  return (
    <View style={styles.row}>
      <Pill label="From" value={langName(source)} onPress={() => setOpen("source")} disabled={disabled} />
      <Pressable
        accessibilityLabel="Swap languages"
        disabled={disabled}
        hitSlop={10}
        onPress={() => {
          void Haptics.selectionAsync();
          onChange({ source: target, target: source });
        }}
        style={({ pressed }) => [styles.swap, pressed && { opacity: 0.6 }]}
      >
        <SymbolView name="arrow.left.arrow.right" tintColor={C.t2} size={18} />
      </Pressable>
      <Pill label="To" value={langName(target)} onPress={() => setOpen("target")} disabled={disabled} />

      <LanguageSheet
        visible={open !== null}
        title={open === "source" ? "Speaker's language" : "Translate into"}
        selected={open === "source" ? source : target}
        onClose={() => setOpen(null)}
        onSelect={(code) => {
          if (open === "source") onChange({ source: code, target });
          else onChange({ source, target: code });
          setOpen(null);
        }}
      />
    </View>
  );
}

function Pill({
  label,
  value,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.pill, pressed && { borderColor: C.accent }]}
    >
      <Text style={styles.pillLabel}>{label}</Text>
      <Text style={styles.pillValue} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

function LanguageSheet({
  visible,
  title,
  selected,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  selected: string;
  onClose: () => void;
  onSelect: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? LANGUAGES.filter(
          (l) => l.name.toLowerCase().includes(q) || l.native.toLowerCase().includes(q),
        )
      : LANGUAGES;
  }, [query]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={() => setQuery("")}
    >
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.search}
          placeholder="Search languages"
          placeholderTextColor={C.t3}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <FlatList
          data={items}
          keyExtractor={(l) => l.code}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const active = item.code === selected;
            return (
              <Pressable
                onPress={() => {
                  void Haptics.selectionAsync();
                  onSelect(item.code);
                }}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: C.surfaceLight }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, active && { color: C.accent }]}>{item.name}</Text>
                  <Text style={styles.itemNative}>{item.native}</Text>
                </View>
                {active && <SymbolView name="checkmark" tintColor={C.accent} size={18} />}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  pill: {
    flex: 1,
    backgroundColor: C.surface,
    borderColor: C.borderLight,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pillLabel: { color: C.t3, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 },
  pillValue: { color: C.w, fontSize: 17, fontWeight: "600", marginTop: 2 },
  swap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.pill,
    backgroundColor: C.surfaceLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: { flex: 1, backgroundColor: C.bg, paddingTop: 16 },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sheetTitle: { color: C.w, fontSize: 20, fontWeight: "700" },
  done: { color: C.accent, fontSize: 17, fontWeight: "600" },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderRadius: RADIUS.sm,
    color: C.w,
    fontSize: 16,
    paddingHorizontal: 14,
    height: 44,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomColor: C.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemName: { color: C.w, fontSize: 17 },
  itemNative: { color: C.t3, fontSize: 14, marginTop: 2 },
});
