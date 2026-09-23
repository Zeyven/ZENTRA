import { tokens } from '@ayra/design-tokens';
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
const tabs = ['Home', 'Chat', 'Tasks', 'Projects'] as const;
export default function App() {
  const [tab, setTab] = useState<(typeof tabs)[number]>('Home');
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand} accessibilityRole="header">
          AYRA
        </Text>
        <Text style={styles.title} accessibilityRole="header">
          {tab}
        </Text>
        <Text style={styles.body}>工作空间正在准备中</Text>
        <Text style={styles.body}>账户、任务与审批功能尚未开放。</Text>
      </ScrollView>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === name }}
            onPress={() => setTab(name)}
            style={styles.tab}
          >
            <Text style={[styles.label, tab === name && styles.selected]}>{name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.colors.background, paddingTop: 40, paddingBottom: 32 },
  content: { padding: 24 },
  brand: { fontSize: 24, color: tokens.colors.accent, marginBottom: 40 },
  title: { fontSize: 32, color: tokens.colors.text, marginBottom: 24 },
  body: { fontSize: 16, color: tokens.colors.secondary, lineHeight: 24, marginBottom: 16 },
  tabs: {
    flexDirection: 'row',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: tokens.colors.border,
  },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  label: { color: tokens.colors.secondary, fontSize: 14 },
  selected: { color: tokens.colors.accent, fontWeight: '700', textDecorationLine: 'underline' },
});
