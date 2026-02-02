"use client";

import { useCallback, useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type DataRow = Record<string, string | number | null>;

type ColumnStats = {
  name: string;
  totalRows: number;
  nullCount: number;
  positiveCount: number;
  dataType: "numérico" | "texto" | "mixto" | "vacío";
  ordered: "ascendente" | "descendente" | "sin orden";
};

type AnalysisResult = {
  totalRows: number;
  totalColumns: number;
  hasNulls: boolean;
  orderedByFirstColumn: boolean;
  totalPositiveValues: number;
  columnsWithNulls: number;
  columnStats: ColumnStats[];
  numericColumns: string[];
  dateColumns: string[];
  rawRows: DataRow[];
};

type HistogramBin = {
  bin: string;
  count: number;
};

const navItems = [
  { id: "upload", label: "Carga" },
  { id: "summary", label: "Resumen" },
  { id: "columns", label: "Columnas" },
  { id: "charts", label: "Visualizaciones" }
];

const toNumber = (value: string | number | null) => {
  if (value === null || value === undefined) {
    return null;
  }
  const numericValue = typeof value === "number" ? value : Number(String(value).replace(/,/g, "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const isNullValue = (value: string | number | null) => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "number") {
    return false;
  }
  return String(value).trim() === "";
};

const detectOrder = (values: Array<string | number>) => {
  if (values.length < 2) {
    return "sin orden" as const;
  }
  let ascending = true;
  let descending = true;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) {
      ascending = false;
    }
    if (values[index] > values[index - 1]) {
      descending = false;
    }
  }
  if (ascending) {
    return "ascendente" as const;
  }
  if (descending) {
    return "descendente" as const;
  }
  return "sin orden" as const;
};

const parseDateValue = (value: string | number | null) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildHistogram = (values: number[], bins = 8): HistogramBin[] => {
  if (values.length === 0) {
    return [];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ bin: `${min}`, count: values.length }];
  }
  const step = (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((value) => {
    const index = Math.min(bins - 1, Math.floor((value - min) / step));
    counts[index] += 1;
  });
  return counts.map((count, index) => {
    const start = (min + step * index).toFixed(2);
    const end = (min + step * (index + 1)).toFixed(2);
    return { bin: `${start} - ${end}`, count };
  });
};

const calculateCorrelation = (xValues: number[], yValues: number[]) => {
  if (xValues.length === 0 || yValues.length === 0 || xValues.length !== yValues.length) {
    return 0;
  }
  const n = xValues.length;
  const meanX = xValues.reduce((sum, value) => sum + value, 0) / n;
  const meanY = yValues.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;
  for (let i = 0; i < n; i += 1) {
    const xDiff = xValues[i] - meanX;
    const yDiff = yValues[i] - meanY;
    numerator += xDiff * yDiff;
    denominatorX += xDiff ** 2;
    denominatorY += yDiff ** 2;
  }
  const denominator = Math.sqrt(denominatorX * denominatorY);
  return denominator === 0 ? 0 : numerator / denominator;
};

const formatBoolean = (value: boolean) => (value ? "Sí" : "No");

export default function HomePage() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedColumns, setExpandedColumns] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const resetState = () => {
    setFileName(null);
    setAnalysis(null);
    setErrorMessage(null);
    setExpandedColumns(new Set());
    setSelectedFile(null);
  };

  const handleFile = useCallback(async (file: File) => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !["csv", "xlsx", "xls"].includes(extension)) {
        throw new Error("Formato de archivo no soportado. Usa CSV o Excel.");
      }
      setFileName(file.name);
      const rows = await parseFile(file, extension);
      const result = analyzeData(rows);
      setAnalysis(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo procesar el archivo.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      void handleFile(file);
    }
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
      void handleFile(file);
    }
  };

  const toggleColumn = (columnName: string) => {
    setExpandedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnName)) {
        next.delete(columnName);
      } else {
        next.add(columnName);
      }
      return next;
    });
  };

  const nullBarData = useMemo(() => {
    if (!analysis) return [];
    return analysis.columnStats.map((column) => ({
      name: column.name,
      nulos: column.nullCount
    }));
  }, [analysis]);

  const positiveBarData = useMemo(() => {
    if (!analysis) return [];
    return analysis.columnStats.map((column) => ({
      name: column.name,
      positivos: column.positiveCount
    }));
  }, [analysis]);

  const histograms = useMemo(() => {
    if (!analysis) return [];
    return analysis.numericColumns.map((column) => {
      const values = analysis.rawRows
        .map((row) => toNumber(row[column]))
        .filter((value): value is number => value !== null);
      return { column, bins: buildHistogram(values) };
    });
  }, [analysis]);

  const correlationMatrix = useMemo(() => {
    if (!analysis) return [];
    const columns = analysis.numericColumns;
    return columns.map((column) => {
      const columnValues = analysis.rawRows
        .map((row) => toNumber(row[column]))
        .filter((value): value is number => value !== null);
      return columns.map((otherColumn) => {
        const otherValues = analysis.rawRows
          .map((row) => toNumber(row[otherColumn]))
          .filter((value): value is number => value !== null);
        const minLength = Math.min(columnValues.length, otherValues.length);
        return calculateCorrelation(columnValues.slice(0, minLength), otherValues.slice(0, minLength));
      });
    });
  }, [analysis]);

  const timeSeriesData = useMemo(() => {
    if (!analysis) return null;
    if (analysis.dateColumns.length === 0 || analysis.numericColumns.length === 0) {
      return null;
    }
    const dateColumn = analysis.dateColumns[0];
    const numericColumn = analysis.numericColumns[0];
    const series = analysis.rawRows
      .map((row) => {
        const dateValue = parseDateValue(row[dateColumn]);
        const numericValue = toNumber(row[numericColumn]);
        if (!dateValue || numericValue === null) {
          return null;
        }
        return { fecha: dateValue, valor: numericValue };
      })
      .filter((item): item is { fecha: Date; valor: number } => item !== null)
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    return series.map((item) => ({
      fecha: item.fecha.toLocaleDateString("es-ES"),
      valor: item.valor
    }));
  }, [analysis]);

  const scatterPairs = useMemo(() => {
    if (!analysis) return [];
    const columns = analysis.numericColumns;
    const pairs: Array<{ x: string; y: string; points: { x: number; y: number }[] }> = [];
    for (let i = 0; i < columns.length; i += 1) {
      for (let j = i + 1; j < columns.length; j += 1) {
        const xColumn = columns[i];
        const yColumn = columns[j];
        const points = analysis.rawRows
          .map((row) => ({
            x: toNumber(row[xColumn]),
            y: toNumber(row[yColumn])
          }))
          .filter((point): point is { x: number; y: number } => point.x !== null && point.y !== null);
        if (points.length > 0) {
          pairs.push({ x: xColumn, y: yColumn, points });
        }
        if (pairs.length >= 4) {
          return pairs;
        }
      }
    }
    return pairs;
  }, [analysis]);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="hidden md:flex md:w-64 md:flex-col md:gap-6 md:p-8">
        <div className="glass rounded-3xl p-6">
          <h1 className="text-2xl font-semibold">Analizador de Datos</h1>
          <p className="mt-2 text-sm text-slate-600">
            Valida, explora y visualiza tus archivos CSV o Excel en segundos.
          </p>
        </div>
        <nav className="glass rounded-3xl p-6">
          <p className="text-xs uppercase tracking-wide text-slate-500">Navegación</p>
          <ul className="mt-4 space-y-3 text-sm">
            {navItems.map((item) => (
              <li key={item.id}>
                <a className="flex items-center gap-2 text-slate-700 hover:text-slate-900" href={`#${item.id}`}>
                  <span className="h-2 w-2 rounded-full bg-purple-400" />
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="glass rounded-3xl p-6">
          <p className="text-sm font-medium">Consejos rápidos</p>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            <li>• Arrastra tu archivo para comenzar el análisis.</li>
            <li>• Observa métricas por columna en tiempo real.</li>
            <li>• Visualiza histogramas y correlaciones.</li>
          </ul>
        </div>
      </aside>

      <main className="flex-1 px-6 pb-28 pt-10 md:px-10 md:pb-10">
        <section className="mb-10 text-center md:text-left">
          <h1 className="text-3xl font-semibold md:text-4xl">Analizador de Datos CSV / Excel</h1>
          <p className="mt-3 text-sm text-slate-600 md:text-base">
            Sube tu dataset, recibe diagnósticos automáticos y explora visualizaciones dinámicas.
          </p>
        </section>

        <section id="upload" className="glass mb-10 rounded-3xl p-6 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Carga tu archivo</h2>
              <p className="mt-2 text-sm text-slate-600">
                Acepta CSV y Excel (.xlsx, .xls). Arrastra o selecciona desde tu dispositivo.
              </p>
            </div>
            <button
              className="rounded-full border border-white/60 bg-white/70 px-5 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow"
              onClick={resetState}
              type="button"
            >
              Reiniciar análisis
            </button>
          </div>

          <div
            className={`mt-6 flex min-h-[180px] flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-6 text-center transition ${
              isDragging
                ? "border-purple-400 bg-white/80"
                : "border-white/60 bg-white/50"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-2xl shadow">
              📂
            </div>
            <p className="text-sm text-slate-700">
              Suelta tu archivo aquí o selecciona uno desde tu dispositivo.
            </p>
            <label className="cursor-pointer rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white">
              Elegir archivo
              <input
                className="hidden"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={onFileChange}
              />
            </label>
            {fileName && (
              <p className="text-xs text-slate-600">Archivo cargado: {fileName}</p>
            )}
            <button
              className="rounded-full border border-slate-900 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-900 transition hover:bg-slate-900 hover:text-white"
              type="button"
              onClick={() => {
                if (selectedFile) {
                  void handleFile(selectedFile);
                } else {
                  setErrorMessage("Primero selecciona un archivo para analizar.");
                }
              }}
            >
              Analizar datos
            </button>
          </div>

          {isLoading && (
            <div className="mt-6 flex items-center justify-center gap-3 text-sm text-slate-600">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
              Analizando y validando datos...
            </div>
          )}
          {errorMessage && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </section>

        {analysis && (
          <>
            <section id="summary" className="mb-10">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Resumen del Dataset</h2>
                <span className="rounded-full bg-white/80 px-4 py-1 text-xs text-slate-600 shadow">
                  {analysis.totalRows} filas · {analysis.totalColumns} columnas
                </span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  { label: "Total de Filas", value: analysis.totalRows },
                  { label: "Total de Columnas", value: analysis.totalColumns },
                  { label: "Columnas con Nulos", value: analysis.columnsWithNulls },
                  { label: "Valores Positivos", value: analysis.totalPositiveValues },
                  { label: "Dataset Ordenado", value: formatBoolean(analysis.orderedByFirstColumn) }
                ].map((card) => (
                  <div key={card.label} className="glass rounded-3xl p-5">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-3 text-xs text-slate-600">
                <span className="rounded-full bg-white/70 px-3 py-1">¿Tiene nulos? {formatBoolean(analysis.hasNulls)}</span>
                <span className="rounded-full bg-white/70 px-3 py-1">
                  Columnas numéricas: {analysis.numericColumns.length}
                </span>
                <span className="rounded-full bg-white/70 px-3 py-1">
                  Columnas tipo fecha: {analysis.dateColumns.length}
                </span>
              </div>
            </section>

            <section id="columns" className="mb-10">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Estado de las Columnas</h2>
                <p className="text-xs text-slate-500">Haz clic para expandir detalles</p>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {analysis.columnStats.map((column) => {
                  const isExpanded = expandedColumns.has(column.name);
                  return (
                    <div key={column.name} className="glass rounded-3xl p-5">
                      <button
                        className="flex w-full items-center justify-between text-left"
                        type="button"
                        onClick={() => toggleColumn(column.name)}
                      >
                        <div>
                          <p className="text-sm text-slate-500">Columna</p>
                          <h3 className="text-lg font-semibold text-slate-900">{column.name}</h3>
                        </div>
                        <span className="text-xl">{isExpanded ? "−" : "+"}</span>
                      </button>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600">
                        <span className="rounded-full bg-white/70 px-3 py-1">Nulos: {column.nullCount}</span>
                        <span className="rounded-full bg-white/70 px-3 py-1">Positivos: {column.positiveCount}</span>
                        <span className="rounded-full bg-white/70 px-3 py-1">Tipo: {column.dataType}</span>
                        <span className="rounded-full bg-white/70 px-3 py-1">Orden: {column.ordered}</span>
                      </div>
                      {isExpanded && (
                        <div className="mt-4 text-sm text-slate-600">
                          <p>
                            Total de filas analizadas: <strong>{column.totalRows}</strong>.
                          </p>
                          <p>
                            Se detectaron <strong>{column.nullCount}</strong> valores vacíos y <strong>{column.positiveCount}</strong> valores positivos.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section id="charts" className="mb-10">
              <h2 className="text-2xl font-semibold">Visualizaciones</h2>
              <p className="mt-2 text-sm text-slate-600">
                Gráficas automáticas para explorar nulos, positivos, distribuciones y relaciones.
              </p>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <div className="glass rounded-3xl p-5">
                  <h3 className="text-sm font-semibold">Nulos por columna</h3>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={nullBarData} margin={{ left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} height={50} />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="nulos" fill="#a855f7" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="glass rounded-3xl p-5">
                  <h3 className="text-sm font-semibold">Valores positivos por columna</h3>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={positiveBarData} margin={{ left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} height={50} />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="positivos" fill="#38bdf8" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {histograms.length > 0 && (
                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  {histograms.map((histogram) => (
                    <div key={histogram.column} className="glass rounded-3xl p-5">
                      <h3 className="text-sm font-semibold">Histograma · {histogram.column}</h3>
                      <div className="mt-4 h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={histogram.bins}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="bin" tick={{ fontSize: 10 }} interval={0} angle={-20} height={60} />
                            <YAxis />
                            <Tooltip />
                            <Bar dataKey="count" fill="#fb7185" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {analysis.numericColumns.length > 1 && (
                <div className="mt-6 glass rounded-3xl p-5">
                  <h3 className="text-sm font-semibold">Mapa de calor de correlación</h3>
                  <div className="mt-4 overflow-x-auto">
                    <div
                      className="grid gap-2 text-xs"
                      style={{
                        gridTemplateColumns: `120px repeat(${analysis.numericColumns.length}, minmax(60px, 1fr))`
                      }}
                    >
                      <div />
                      {analysis.numericColumns.map((column) => (
                        <div key={column} className="text-center font-semibold">
                          {column}
                        </div>
                      ))}
                      {analysis.numericColumns.map((rowColumn, rowIndex) => (
                        <div key={rowColumn} className="contents">
                          <div className="font-semibold">{rowColumn}</div>
                          {analysis.numericColumns.map((column, columnIndex) => {
                            const value = correlationMatrix[rowIndex]?.[columnIndex] ?? 0;
                            const intensity = Math.round(Math.abs(value) * 200 + 30);
                            const background = `rgba(59, 130, 246, ${Math.abs(value).toFixed(2)})`;
                            return (
                              <div
                                key={`${rowColumn}-${column}`}
                                className="flex items-center justify-center rounded-2xl p-2 text-[11px] text-slate-900"
                                style={{ background, color: intensity > 120 ? "white" : "#0f172a" }}
                              >
                                {value.toFixed(2)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {timeSeriesData && (
                <div className="mt-6 glass rounded-3xl p-5">
                  <h3 className="text-sm font-semibold">Serie temporal detectada</h3>
                  <div className="mt-4 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={timeSeriesData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="fecha" tick={{ fontSize: 10 }} angle={-15} height={50} />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="valor" stroke="#4f46e5" strokeWidth={3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {scatterPairs.length > 0 && (
                <div className="mt-6 grid gap-6 lg:grid-cols-2">
                  {scatterPairs.map((pair) => (
                    <div key={`${pair.x}-${pair.y}`} className="glass rounded-3xl p-5">
                      <h3 className="text-sm font-semibold">
                        Dispersión · {pair.x} vs {pair.y}
                      </h3>
                      <div className="mt-4 h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" dataKey="x" name={pair.x} />
                            <YAxis type="number" dataKey="y" name={pair.y} />
                            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                            <Scatter data={pair.points} fill="#0ea5e9" />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-around border-t border-white/40 bg-white/70 px-4 py-3 text-xs text-slate-600 backdrop-blur md:hidden">
        {navItems.map((item) => (
          <a key={item.id} className="flex flex-col items-center gap-1" href={`#${item.id}`}>
            <span className="h-2 w-2 rounded-full bg-purple-400" />
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

async function parseFile(file: File, extension: string): Promise<DataRow[]> {
  if (extension === "csv") {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true
    });
    if (parsed.errors.length > 0) {
      throw new Error("El archivo CSV contiene errores de formato.");
    }
    return parsed.data.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value === "" ? null : value])
      )
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const jsonData = XLSX.utils.sheet_to_json<Record<string, string | number>>(worksheet, { defval: null });
  return jsonData.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === "" ? null : value])
    )
  );
}

function analyzeData(rows: DataRow[]): AnalysisResult {
  if (rows.length === 0) {
    throw new Error("El archivo está vacío o no tiene filas válidas.");
  }

  const columns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row)))
  );

  const columnStats: ColumnStats[] = columns.map((column) => {
    const values = rows.map((row) => row[column] ?? null);
    const nullCount = values.filter((value) => isNullValue(value)).length;
    const numericValues = values
      .map((value) => toNumber(value))
      .filter((value): value is number => value !== null);
    const positiveCount = numericValues.filter((value) => value > 0).length;

    const nonNullValues = values.filter((value): value is string | number => !isNullValue(value));
    let dataType: ColumnStats["dataType"] = "vacío";
    if (nonNullValues.length > 0) {
      const numericCount = nonNullValues.filter((value) => toNumber(value) !== null).length;
      if (numericCount === nonNullValues.length) {
        dataType = "numérico";
      } else if (numericCount === 0) {
        dataType = "texto";
      } else {
        dataType = "mixto";
      }
    }

    const comparableValues = nonNullValues.map((value) => (typeof value === "number" ? value : String(value)));
    const ordered = detectOrder(comparableValues as Array<string | number>);

    return {
      name: column,
      totalRows: rows.length,
      nullCount,
      positiveCount,
      dataType,
      ordered
    };
  });

  const numericColumns = columnStats
    .filter((column) => column.dataType === "numérico")
    .map((column) => column.name);

  const dateColumns = columns.filter((column) => {
    const nonNullValues = rows
      .map((row) => row[column])
      .filter((value): value is string | number => !isNullValue(value));
    if (nonNullValues.length === 0) {
      return false;
    }
    const dateMatches = nonNullValues
      .slice(0, 15)
      .filter((value) => parseDateValue(value) !== null).length;
    return dateMatches >= Math.min(5, nonNullValues.length);
  });

  const columnsWithNulls = columnStats.filter((column) => column.nullCount > 0).length;
  const totalPositiveValues = columnStats.reduce((sum, column) => sum + column.positiveCount, 0);

  const firstColumn = columns[0];
  const firstColumnValues = rows
    .map((row) => row[firstColumn])
    .filter((value): value is string | number => !isNullValue(value))
    .map((value) => (typeof value === "number" ? value : String(value)));
  const orderedByFirstColumn = detectOrder(firstColumnValues) !== "sin orden";

  return {
    totalRows: rows.length,
    totalColumns: columns.length,
    hasNulls: columnsWithNulls > 0,
    orderedByFirstColumn,
    totalPositiveValues,
    columnsWithNulls,
    columnStats,
    numericColumns,
    dateColumns,
    rawRows: rows
  };
}
