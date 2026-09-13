# Diseno de Padel Rush

## Objetivo

Padel Rush es una aplicacion web ligera para operar un torneo relampago de padel que se completa en un dia. Gestiona las categorias masculino, femenino y mixto en paralelo, forma parejas equilibradas, genera cuadros de doble eliminacion y programa partidos automaticamente sin solapar jugadores ni canchas.

No habra cuentas de jugadores, pagos, mensajeria, estadisticas ni historial de torneos. El administrador y los organizadores son los unicos usuarios autenticados. Jugadores y publico consultan la informacion mediante un enlace publico de solo lectura, sin iniciar sesion.

## Roles y acceso

| Rol | Permisos |
| --- | --- |
| Administrador | Acceso total. Gestiona cuentas de organizadores, configuracion global y cualquier torneo. |
| Organizador | Gestiona los torneos que tenga asignados: participantes, parejas, calendario, resultados y enlace publico. |
| Publico | Consulta sin autenticacion el calendario, estado de canchas y cuadros de un torneo mediante su enlace publico. |

La autenticacion usa solamente nombre de usuario y contrasena. No se guarda ni se solicita correo electronico. No existe registro publico: el administrador crea las cuentas de organizadores y puede restablecer sus contrasenas. Un administrador inicial se configura al desplegar la aplicacion.

## Configuracion del torneo

Cada torneo tiene:

- Nombre, fecha y zona horaria.
- Hora de inicio, duracion estimada de un bloque de partido y descanso minimo entre partidos de una misma persona.
- Dos o tres canchas habilitadas. El organizador selecciona dos cuando solo se usen las cubiertas, o las tres con condiciones favorables.
- Estado: borrador, en curso o finalizado.
- Un enlace publico no adivinable.

El torneo comienza como borrador. Solo puede iniciarse despues de confirmar parejas y generar los cuadros de las categorias activas. Un torneo finalizado no se conserva como historial de producto y puede eliminarse desde el panel administrativo.

## Participantes e inscripciones

Un participante contiene nombre, genero y nivel entero de 1 a 5; 5 representa mayor habilidad. Al registrarlo, y hasta crear las parejas, el organizador define o edita sus inscripciones:

- Hombres: masculino, mixto o ambas.
- Mujeres: femenino, mixto o ambas.

No hay restriccion que obligue a que toda persona de una categoria propia juegue mixto. Una persona puede pertenecer simultaneamente a una pareja de su categoria propia y a una pareja de mixto, pero nunca a dos parejas de la misma categoria.

## Formacion de parejas

Para cada categoria, la aplicacion propone parejas antes de generar el cuadro:

1. Ordena los participantes inscritos por nivel, de 5 a 1.
2. Une el nivel mas alto disponible con el mas bajo disponible.
3. Repite hasta formar todas las parejas.

Este criterio compensa niveles altos y bajos y reduce la diferencia estimada entre parejas. Los empates se resuelven de forma estable. El organizador puede intercambiar integrantes, crear una pareja manualmente o ajustar las inscripciones antes de confirmar.

Al confirmar, se bloquean inscripciones y parejas. Cada categoria activa debe tener una cantidad de parejas potencia de dos. Si no la tiene, el sistema explica que categoria debe corregirse y no genera los cuadros.

## Formato deportivo

Las tres categorias se celebran de forma paralela:

- Masculino: parejas compuestas por hombres.
- Femenino: parejas compuestas por mujeres.
- Mixto: una mujer y un hombre por pareja.

Cada categoria usa doble eliminacion. La primera derrota desplaza la pareja al cuadro de perdedores; la segunda la elimina. Los campeones de los cuadros de ganadores y perdedores disputan la final.

La final tiene reinicio: el campeon del cuadro de ganadores llega invicto y se corona si gana el primer partido. Si gana la pareja que viene de perdedores, ambas tendran una derrota y se juega un segundo partido decisivo.

Todos los partidos son al mejor de tres sets, con sets a seis juegos, diferencia de dos juegos y tie-break a 6-6.

## Cuadro, resultados y correcciones

Al confirmar las parejas, el motor crea una estructura determinista de doble eliminacion por categoria. Cada partido conserva sus destinos de ganador y perdedor; la final de reinicio se habilita solo cuando corresponde.

El organizador carga el marcador por sets al terminar un partido. La operacion se guarda como una transaccion: valida el marcador, registra el resultado, asigna las parejas a los cruces dependientes y actualiza la programacion afectada. La vista publica refleja el nuevo estado en su siguiente actualizacion automatica.

Un resultado puede editarse solo si ningun partido posterior que dependa de el ha finalizado. Si ya existen dependientes jugados, el organizador debe deshacer primero sus resultados en orden inverso. Esto impide cuadros inconsistentes.

## Programacion

El planificador usa como restricciones las canchas habilitadas, hora de inicio, bloques de partido, descanso minimo, dependencias del cuadro y participacion simultanea en categorias.

Al generar el torneo, asigna automaticamente los partidos iniciales a las canchas y bloques disponibles. Los cruces futuros se mantienen pendientes hasta conocer sus parejas. Al cargar un resultado, el sistema asigna cada nuevo partido al primer bloque valido, sin solapar a ninguna persona en masculino, femenino o mixto.

El organizador puede mover manualmente una cancha o un horario. El sistema valida la modificacion, advierte sobre conflictos y reprograma los partidos posteriores afectados. Nunca modifica resultados como consecuencia de una reprogramacion.

## Interfaz

La interfaz sera responsiva y orientada a operacion rapida desde telefono, tableta o portatil:

- Inicio de sesion por usuario y contrasena.
- Listado de torneos y acceso segun rol.
- Asistente de creacion y configuracion del torneo.
- Gestion de participantes e inscripciones.
- Revision de parejas sugeridas y ajustes manuales.
- Tablero operativo de partidos, canchas, horarios y carga de resultados.
- Pagina publica con horarios, estado de canchas y cuadros de ganadores y perdedores de las tres categorias.

La pagina publica consulta actualizaciones periodicamente. Esto evita WebSockets y mantiene bajo el consumo de recursos, sin impedir que el publico vea el avance del torneo con una demora acotada.

## Arquitectura tecnica

La solucion es una aplicacion monolitica web desplegada en Railway:

- Next.js 16 con TypeScript y App Router para las paginas del panel y la vista publica.
- Logica de dominio y validaciones ejecutadas en el servidor mediante acciones del servidor y manejadores de rutas cuando sean necesarios.
- PostgreSQL administrado por Railway como base de datos persistente.
- Drizzle ORM para esquema tipado, consultas, transacciones y migraciones SQL versionadas.
- Autenticacion propia y minima: tabla de usuarios, hash seguro de contrasena, sesiones revocables y cookies `HttpOnly` seguras.
- Docker Compose para reproducir localmente la aplicacion y PostgreSQL durante el desarrollo. Railway usara servicios separados para aplicacion y base de datos, no Docker Compose en produccion.

PostgreSQL almacena usuarios, torneos, canchas, participantes, inscripciones, parejas, partidos, marcadores y estructura de cuadro. Las operaciones que hacen avanzar el torneo se ejecutan en transaccion para evitar estados parciales o conflictos entre administrador y organizador.

La aplicacion se desplegara desde el repositorio en Railway. La configuracion sensible, incluida la cadena de conexion y la clave de sesion, se definira como variables de entorno. Se generara una copia de seguridad logica de PostgreSQL con `pg_dump` antes o despues de cada torneo.

## Validaciones y errores

El servidor rechazara y comunicara de forma clara:

- Acciones sin sesion o con un rol no autorizado.
- Niveles fuera del rango de 1 a 5.
- Inscripciones incompatibles con el genero o parejas incompletas.
- Personas repetidas en una misma categoria.
- Categorias con cantidades de parejas que no sean potencia de dos al generar cuadros.
- Marcadores que no cumplan el formato al mejor de tres sets.
- Horarios que solapen participantes, canchas o incumplan el descanso minimo.
- Cambios de resultado con partidos dependientes ya finalizados.

Una validacion fallida no altera los datos. El panel muestra el motivo y la accion necesaria para continuar.

## Pruebas

- Unitarias: algoritmo de parejas, validaciones de marcador, avance por ganador y perdedor, reinicio de final y programador de horarios.
- Integracion: transacciones de resultado, reglas de acceso, restricciones de inscripcion y bloqueo de correcciones inconsistentes.
- Extremo a extremo: crear torneo, registrar participantes, confirmar parejas, generar los tres cuadros, operar resultados y comprobar el enlace publico sin inicio de sesion.

## Fuera de alcance

- Registro o inicio de sesion de jugadores y publico.
- Correo electronico, recuperacion automatica de contrasena y notificaciones.
- Pagos, inscripciones en linea y cobros.
- Historial, estadisticas, ranking o perfiles de jugadores.
- Mensajeria, chat y streaming de resultados.
- Funcionamiento sin conexion.
