# Padel Rush

Aplicacion web liviana para operar un torneo relampago de padel de un dia con categorias masculino, femenino y mixto, parejas equilibradas, doble eliminacion y programacion automatica de partidos.

## Requisitos

- Node.js 22 o superior
- Docker con Compose para el entorno local
- PostgreSQL accesible por `DATABASE_URL`

## Desarrollo local

```bash
cp .env.example .env
docker compose up -d postgres
npm install --legacy-peer-deps
npm run db:migrate
npm run dev
```

La aplicacion queda en `http://localhost:3000`. El administrador inicial se crea con `BOOTSTRAP_ADMIN_USERNAME` y `BOOTSTRAP_ADMIN_PASSWORD` durante la primera migracion; despues esas variables se ignoran.

## Scripts

| Script | Uso |
| --- | --- |
| `npm run dev` | Desarrollo local |
| `npm run build` | Compilar produccion |
| `npm run start` | Servir produccion |
| `npm test` | Pruebas unitarias e integracion |
| `npm run test:coverage` | Cobertura |
| `npm run test:e2e` | Pruebas de navegador con Playwright |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generar migraciones |
| `npm run db:migrate` | Aplicar migraciones y crear el administrador inicial |
| `npm run seed:demo` | Datos de demostracion (requiere variables `DEMO_*`) |
| `npm run backup` | Copia de seguridad con `pg_dump` |

## Despliegue en Railway

1. Crea un proyecto y agrega un servicio PostgreSQL; Railway expone `DATABASE_URL`.
2. Despliega este repositorio como servicio web. `railway.json` construye la imagen y ejecuta `npm run db:migrate && npm run start`.
3. Define `BOOTSTRAP_ADMIN_USERNAME` y `BOOTSTRAP_ADMIN_PASSWORD` solo para la primera migracion. Luego elimínalas o dejales sin efecto.
4. Verifica `/login` como healthcheck.
5. Programa `npm run backup` antes y despues de cada torneo; conserva las copias 30 dias y restaura con `pg_restore -d "$DATABASE_URL" backups/padel-rush-<fecha>.dump`.
   - Localmente, `backup.sh` usa `pg_dump` si esta instalado o el contenedor de Compose con `COMPOSE_DATABASE_URL` (por defecto `postgres://padel:padel@postgres:5432/padel_rush`).

## Flujo de operacion

1. El organizador crea el torneo, habilita dos o tres canchas y registra participantes con nivel 1 a 5.
2. La aplicacion propone parejas equilibradas; el organizador las ajusta y confirma.
3. Al iniciar el torneo se generan los cuadros de doble eliminacion y el enlace publico.
4. El tablero de partidos permite iniciar, cargar marcador, registrar ausencia o retiro, mover horarios y corregir resultados en orden inverso.
5. El publico consulta el avance en el enlace publico sin iniciar sesion.

## Reglas deportivas

- Partidos previos a las finales: un set a nueve juegos con punto de oro y tie-break en 8-8.
- Final de ganadores, final de perdedores, gran final y su reinicio: mejor de tres sets con tie-break en 6-6 y punto de oro.
- Doble eliminacion: la segunda derrota elimina; si la pareja del cuadro de perdedores gana la gran final, se juega un reinicio.
- Una persona puede competir en su categoria propia y en mixto, nunca en dos parejas de la misma categoria.
