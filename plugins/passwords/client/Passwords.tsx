import { PadlockIcon } from "outline-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Modal from "~/components/Modal";
import Scene from "~/components/Scene";
import { client } from "~/utils/ApiClient";
import type { PasswordEntry, PasswordValues } from "../shared/schema";

interface Page {
  entries: PasswordEntry[];
  total: number;
  canWrite: boolean;
}
const pageSize = 50;

/** Workspace credential table with explicit secret disclosure and editing. */
export function Passwords() {
  const [page, setPage] = useState<Page>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PasswordEntry | "new">();
  const [deleting, setDeleting] = useState<PasswordEntry>();
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError("");
    try {
      const result = await client.post<{ data: Page }>("/passwords.list", {
        offset,
        limit: pageSize,
      });
      if (current === request.current) {
        setPage(result.data);
      }
    } catch {
      if (current === request.current) {
        setError("Impossibile caricare le password. Riprova.");
      }
    } finally {
      if (current === request.current) {
        setLoading(false);
      }
    }
  }, [offset]);
  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  const handleDelete = async () => {
    if (!deleting) {
      return;
    }
    setBusy(true);
    try {
      await client.post("/passwords.delete", {
        id: deleting.id,
        version: deleting.version,
      });
      setDeleting(undefined);
      if (page?.entries.length === 1 && offset > 0) {
        setOffset(offset - pageSize);
      } else {
        await load();
      }
    } catch {
      setError(
        "Eliminazione non riuscita. La voce potrebbe essere cambiata: aggiorna e riprova."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Scene icon={<PadlockIcon />} title="Password" wide>
      <Toolbar>
        <Heading>Password</Heading>
        <Actions>
          <Button neutral onClick={load} disabled={loading}>
            Aggiorna
          </Button>
          {page?.canWrite && (
            <Button onClick={() => setEditing("new")}>Nuova password</Button>
          )}
        </Actions>
      </Toolbar>
      <p>
        Sito, username, password e note. Condivisi con i membri del workspace.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Caricamento…</p>}
      {!loading && page?.total === 0 && (
        <Empty>Nessuna password salvata. Aggiungi il primo accesso.</Empty>
      )}
      {page && page.entries.length > 0 && (
        <TableScroll aria-busy={loading}>
          <Table>
            <thead>
              <tr>
                <th scope="col">Sito</th>
                <th scope="col">Username</th>
                <th scope="col">Password</th>
                <th scope="col">Note</th>
                <th scope="col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={`${entry.id}:${entry.version}`}>
                  <td>
                    <a
                      href={entry.site}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      {entry.site}
                    </a>
                  </td>
                  <td>{entry.username || "—"}</td>
                  <td>
                    <Secret entry={entry} />
                  </td>
                  <td>
                    <Notes>{entry.notes || "—"}</Notes>
                  </td>
                  <td>
                    {page.canWrite && (
                      <Actions>
                        <Button neutral onClick={() => setEditing(entry)}>
                          Modifica
                        </Button>
                        <Button
                          neutral
                          onClick={() => {
                            setError("");
                            setDeleting(entry);
                          }}
                        >
                          Elimina
                        </Button>
                      </Actions>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
      {page && page.total > pageSize && (
        <Toolbar>
          <span>
            {offset + 1}–{Math.min(offset + pageSize, page.total)} di{" "}
            {page.total}
          </span>
          <Actions>
            <Button
              neutral
              disabled={offset === 0 || loading}
              onClick={() => setOffset(offset - pageSize)}
            >
              Precedenti
            </Button>
            <Button
              neutral
              disabled={offset + pageSize >= page.total || loading}
              onClick={() => setOffset(offset + pageSize)}
            >
              Successive
            </Button>
          </Actions>
        </Toolbar>
      )}
      <Modal
        isOpen={!!editing}
        title={editing === "new" ? "Nuova password" : "Modifica password"}
        onRequestClose={() => setEditing(undefined)}
      >
        {editing && (
          <Editor
            key={editing === "new" ? "new" : editing.id}
            entry={editing}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined);
              void load();
            }}
          />
        )}
      </Modal>
      <Modal
        isOpen={!!deleting}
        title="Elimina password"
        onRequestClose={() => {
          if (!busy) {
            setDeleting(undefined);
          }
        }}
      >
        <p>
          Eliminare l’accesso a {deleting?.site} per{" "}
          {deleting?.username || "questo utente"}?
        </p>
        <p>La voce sarà rimossa definitivamente.</p>
        {error && <p role="alert">{error}</p>}
        <Actions>
          <Button
            neutral
            disabled={busy}
            onClick={() => setDeleting(undefined)}
          >
            Annulla
          </Button>
          <Button danger disabled={busy} onClick={handleDelete}>
            Elimina
          </Button>
        </Actions>
      </Modal>
    </Scene>
  );
}

interface SecretProps {
  entry: PasswordEntry;
}
/** Fetches secrets only on demand and clears disclosure on blur, hiding, or timeout. */
function Secret({ entry }: SecretProps) {
  const [secret, setSecret] = useState<string>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const clear = () => {
      generation.current += 1;
      setSecret(undefined);
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      generation.current += 1;
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  useEffect(() => {
    if (secret === undefined) {
      return;
    }
    const timer = window.setTimeout(() => setSecret(undefined), 30000);
    return () => window.clearTimeout(timer);
  }, [secret]);
  const handleRead = async (copy: boolean) => {
    const current = generation.current;
    setBusy(true);
    setMessage("");
    try {
      const result = await client.post<{ data: PasswordValues }>(
        "/passwords.info",
        { id: entry.id }
      );
      if (generation.current !== current) {
        return;
      }
      if (copy) {
        await navigator.clipboard.writeText(result.data.password);
        setMessage("Copiata");
      } else {
        setSecret(result.data.password);
      }
    } catch {
      setMessage("Operazione non riuscita. Riprova.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SecretCell>
      <code>{secret ?? "••••••••"}</code>
      <Actions>
        <Button
          neutral
          disabled={busy}
          aria-label={`${secret === undefined ? "Mostra" : "Nascondi"} password per ${entry.site}`}
          onClick={() => {
            if (secret === undefined) {
              void handleRead(false);
            } else {
              setSecret(undefined);
            }
          }}
        >
          {secret === undefined ? "Mostra" : "Nascondi"}
        </Button>
        <Button
          neutral
          disabled={busy}
          aria-label={`Copia password per ${entry.site}`}
          onClick={() => handleRead(true)}
        >
          Copia
        </Button>
      </Actions>
      <span role="status">{message}</span>
    </SecretCell>
  );
}

interface EditorProps {
  entry: PasswordEntry | "new";
  onClose: () => void;
  onSaved: () => void;
}
/** Edits metadata without fetching the existing secret; blank preserves it on update. */
function Editor({ entry, onClose, onSaved }: EditorProps) {
  const [values, setValues] = useState({
    site: entry === "new" ? "" : entry.site,
    username: entry === "new" ? "" : entry.username,
    password: "",
    notes: entry === "new" ? "" : entry.notes,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (entry === "new") {
        await client.post("/passwords.create", values);
      } else {
        const { password, ...metadata } = values;
        await client.post("/passwords.update", {
          id: entry.id,
          version: entry.version,
          ...metadata,
          ...(password ? { password } : {}),
        });
      }
      onSaved();
    } catch {
      setError(
        "Salvataggio non riuscito. Controlla il sito e, se la voce è cambiata, chiudi e aggiorna la tabella."
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Form onSubmit={handleSubmit}>
      <label>
        Sito
        <Input
          autoFocus
          type="url"
          required
          maxLength={2048}
          placeholder="https://esempio.it"
          value={values.site}
          onChange={(e) => setValues({ ...values, site: e.target.value })}
        />
      </label>
      <label>
        Username
        <Input
          autoComplete="off"
          maxLength={1024}
          value={values.username}
          onChange={(e) => setValues({ ...values, username: e.target.value })}
        />
      </label>
      <label>
        Password
        <Input
          type="password"
          autoComplete="new-password"
          required={entry === "new"}
          maxLength={16384}
          value={values.password}
          onChange={(e) => setValues({ ...values, password: e.target.value })}
        />
      </label>
      {entry !== "new" && (
        <small>Lascia vuoto per mantenere la password attuale.</small>
      )}
      <label>
        Note
        <Textarea
          rows={4}
          maxLength={16384}
          value={values.notes}
          onChange={(e) => setValues({ ...values, notes: e.target.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Actions>
        <Button neutral type="button" disabled={busy} onClick={onClose}>
          Annulla
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Salvataggio…" : "Salva"}
        </Button>
      </Actions>
    </Form>
  );
}

const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin: 16px 0;
`;
const Actions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;
const Empty = styled.p`
  padding: 48px 16px;
  text-align: center;
  color: ${s("textSecondary")};
`;
const TableScroll = styled.div`
  overflow-x: auto;
`;
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  th,
  td {
    padding: 14px 12px;
    border-bottom: 1px solid ${s("divider")};
    vertical-align: top;
  }
  th {
    color: ${s("textSecondary")};
    font-weight: 500;
  }
  td {
    min-width: 140px;
    max-width: 340px;
    overflow-wrap: anywhere;
  }
`;
const Notes = styled.div`
  white-space: pre-wrap;
  max-height: 140px;
  overflow-y: auto;
`;
const SecretCell = styled.div`
  display: grid;
  gap: 8px;
  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
`;
const Form = styled.form`
  display: grid;
  gap: 16px;
  label {
    display: grid;
    gap: 6px;
  }
`;
const Input = styled.input`
  width: 100%;
  padding: 8px 10px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("inputBackground")};
  color: ${s("text")};
  font: inherit;
`;
const Textarea = styled.textarea`
  width: 100%;
  padding: 8px 10px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  background: ${s("inputBackground")};
  color: ${s("text")};
  font: inherit;
  resize: vertical;
`;
