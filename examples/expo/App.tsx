import React, { useEffect, useRef, useState } from "react";
import { Button, ScrollView, Text, View } from "react-native";
import { createQuickJS, ENGINE_REVISION } from "expo-quickjs";
import { ExpoCodemodeSandbox } from "pi-codemode-expo";

/** Controlled FPL-shaped workflow: no credentials, network or model calls. */
export default function App() {
  const [result, setResult] = useState("Ready");
  const [ticks, setTicks] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const engine = useRef<ReturnType<typeof createQuickJS> | null>(null);
  const sandbox = useRef<ExpoCodemodeSandbox | null>(null);
  useEffect(() => {
    engine.current = createQuickJS();
    sandbox.current = new ExpoCodemodeSandbox({
      engine: engine.current,
      engineRevision: ENGINE_REVISION,
      tools: [
        {
          name: "players",
          execute: async (_args, { signal }) => {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, 100);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(Error("Cancelled"));
                },
                { once: true },
              );
            });
            return [
              { id: 1, name: "Controlled Player", points: 7 },
              { id: 2, name: "Other Player", points: 4 },
            ];
          },
        },
      ],
    });
    const timer = setInterval(() => setTicks((value) => value + 1), 100);
    return () => {
      clearInterval(timer);
      abort.current?.abort();
      void (async () => {
        await sandbox.current?.close();
        await engine.current?.close();
      })();
    };
  }, []);
  async function run(code: string) {
    abort.current = new AbortController();
    setResult("Running");
    try {
      setResult(
        JSON.stringify(
          await sandbox.current!.execute(code, {
            signal: abort.current.signal,
          }),
          null,
          2,
        ),
      );
    } catch (error) {
      setResult(String(error));
    }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <Text>Hermes responsiveness counter: {ticks}</Text>
      <Button
        title="Controlled player mapping"
        onPress={() =>
          void run(
            'const players=await tools.players({}); store("players",players); text(players.map(p=>({id:p.id,points:p.points}))); return players.length;',
          )
        }
      />
      <Button title="CPU loop" onPress={() => void run("while(true) {}")} />
      <Button
        title="Microtask loop"
        onPress={() => void run("while(true) await null;")}
      />
      <Button title="Cancel" onPress={() => abort.current?.abort()} />
      <View>
        <Text selectable>{result}</Text>
      </View>
    </ScrollView>
  );
}
