import { useEffect, useState } from "react";
import styled from "styled-components";
import Button from "~/components/Button";
import { client } from "~/utils/ApiClient";
import { PasskeyCredential } from "../shared/schema";
import type { PasswordEntry } from "../shared/schema";

interface Props {
  entry: PasswordEntry;
  canWrite: boolean;
  onChanged: () => void;
}

/** Configures encrypted login factors without retrieving existing private keys or seeds. */
export function LoginSecurity({ entry, canWrite, onChanged }: Props) {
  const [current, setCurrent] = useState(entry);
  const [setup, setSetup] = useState("");
  const [passkey, setPasskey] = useState("");
  const [code, setCode] = useState<{ code: string; expiresAt: string }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const clear = () => setCode(undefined);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    const timer = code
      ? window.setTimeout(
          clear,
          Math.max(0, Date.parse(code.expiresAt) - Date.now())
        )
      : undefined;
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [code]);
  const handleSave = async (kind: "setTotp" | "setPasskey", remove = false) => {
    setBusy(true);
    setError("");
    setCode(undefined);
    try {
      const factor =
        kind === "setTotp"
          ? { configuration: remove ? null : setup }
          : {
              credential: remove
                ? null
                : PasskeyCredential.parse(JSON.parse(passkey)),
            };
      const result = await client.post<{ data: PasswordEntry }>(
        `/passwords.${kind}`,
        { id: current.id, version: current.version, ...factor }
      );
      setCurrent(result.data);
      setSetup("");
      setPasskey("");
      onChanged();
    } catch {
      setError(
        "Salvataggio non riuscito. Controlla il formato e il dominio di login; se la voce è cambiata, chiudi e riapri questa finestra."
      );
    } finally {
      setBusy(false);
    }
  };
  const handleCode = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await client.post<{
        data: { code: string; expiresAt: string };
      }>("/passwords.totp", {
        id: current.id,
        origin: new URL(current.loginUrl || current.site).origin,
      });
      setCode(result.data);
    } catch {
      setError(
        "Impossibile generare il codice. Verifica il link HTTPS di login."
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel>
      <p>
        Dominio di login: {new URL(current.loginUrl || current.site).hostname}.
        Puoi impostare un link di login diverso dal sito con Modifica.
      </p>
      <h3>Codici 2FA (TOTP)</h3>
      <p>
        {current.hasTotp
          ? "Configurato. Gli agenti possono richiedere il codice al momento del login."
          : "Non configurato. Attiva un’app di autenticazione nelle impostazioni di sicurezza del sito e salva qui la chiave di configurazione."}
      </p>
      {current.hasTotp && (
        <div>
          <Button neutral disabled={busy} onClick={handleCode}>
            Genera codice
          </Button>
          {code && (
            <p role="status">
              <code>{code.code}</code> · valido fino alle{" "}
              {new Date(code.expiresAt).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
      {canWrite && (
        <>
          <label>
            Chiave TOTP o URI otpauth
            <input
              type="password"
              autoComplete="new-password"
              value={setup}
              maxLength={4096}
              onChange={(e) => setSetup(e.target.value)}
            />
          </label>
          <div>
            <Button
              disabled={busy || !setup.trim()}
              onClick={() => handleSave("setTotp")}
            >
              Salva TOTP
            </Button>
            {current.hasTotp && (
              <Button
                neutral
                disabled={busy}
                onClick={() => handleSave("setTotp", true)}
              >
                Rimuovi TOTP
              </Button>
            )}
          </div>
          <small>
            Salva la chiave iniziale, non il codice di sei cifre. Conferma poi
            l’attivazione sul sito con il codice generato.
          </small>
        </>
      )}
      <h3>Passkey per gli agenti</h3>
      <p>
        {current.hasPasskey
          ? `Configurata per ${current.passkeyRpId}.`
          : "Non configurata."}{" "}
        La prima registrazione si fa sul sito con il browser dell’agente;
        l’agente la salva direttamente qui. Non creare la passkey su Outline:
        deve appartenere al sito di destinazione.
      </p>
      <p>
        Le passkey già in iCloud, Google Password Manager o chiavi fisiche non
        sono importabili da una schermata. Registra una passkey software
        dedicata. Serve un browser Chromium compatibile; alcuni siti possono
        richiedere comunque una verifica manuale.
      </p>
      {canWrite && (
        <>
          <details>
            <summary>
              Importa una passkey software preparata dall’agente
            </summary>
            <label>
              Credenziale JSON
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size <= 20000) {
                    setPasskey(await file.text());
                  } else {
                    setError("Seleziona un JSON fino a 20 KB.");
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              disabled={busy || !passkey}
              onClick={() => handleSave("setPasskey")}
            >
              Importa passkey
            </Button>
          </details>
          {current.hasPasskey && (
            <Button
              neutral
              disabled={busy}
              onClick={() => handleSave("setPasskey", true)}
            >
              Rimuovi passkey da Outline
            </Button>
          )}
          <small>
            Rimuovere un fattore da Outline non lo revoca sul sito: gestisci la
            revoca nelle impostazioni di sicurezza del servizio.
          </small>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Panel>
  );
}
const Panel = styled.div`
  display: grid;
  gap: 12px;
  p {
    margin: 0;
  }
  h3 {
    margin: 12px 0 0;
  }
  label {
    display: grid;
    gap: 6px;
  }
  input {
    max-width: 100%;
    padding: 8px;
  }
  button {
    margin-right: 8px;
  }
`;
