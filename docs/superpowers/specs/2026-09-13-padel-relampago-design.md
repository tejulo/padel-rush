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

La autenticacion usa solamente nombre de usuario y contrasena. No se guarda ni se solicita correo electronico. No existe registro publico: el administrador crea las cuentas de organizadores y puede restablecer sus contrasenas. El usuario tiene de 3 a 32 caracteres alfanumericos sin espacios y la contrasena al menos 12 caracteres. Un administrador inicial se crea al inicializar la base de datos con variables de entorno de un solo uso; nunca hay credenciales predeterminadas en el codigo.

## Configuracion del torneo

Cada torneo tiene:

- Nombre, fecha y zona horaria.
- Hora de inicio, hora limite, duracion estimada para partidos cortos, duracion estimada para partidos largos y descanso minimo entre partidos de una misma persona.
- Dos o tres canchas habilitadas. El organizador selecciona dos cuando solo se usen las cubiertas, o las tres con condiciones favorables.
- Estado: borrador, en curso, finalizado o cancelado.
- Un enlace publico no adivinable.

El torneo comienza como borrador. Solo puede iniciarse despues de confirmar parejas y generar los cuadros de las categorias activas. Si una categoria no tiene al menos dos parejas o no tiene una potencia de dos, se cancela esa categoria y pueden iniciarse las demas. No se puede iniciar un torneo sin ninguna categoria activa.

Al concluir todas las categorias activas con campeon o canceladas, el torneo se marca finalizado automaticamente. Si una incidencia impide terminar el evento, el organizador o administrador lo marca cancelado y no se declara campeon para las categorias interrumpidas. El administrador puede eliminar torneos finalizados o cancelados y el organizador puede eliminar sus borradores. Los enlaces de torneos finalizados o cancelados permanecen visibles hasta que el administrador elimina el torneo.

Los valores globales de duracion corta, duracion larga, descanso y hora limite se copian como valores predeterminados al crear un torneo. Cambiarlos globalmente no modifica torneos existentes. Tras iniciar el torneo se bloquean fecha, hora inicial, duraciones y descanso; solo permanecen editables las canchas y los partidos pendientes.

## Participantes e inscripciones

Un participante contiene nombre, genero y nivel entero de 1 a 5; 5 representa mayor habilidad. En esta version, el genero se limita a hombre o mujer porque el reglamento solo define esas categorias. Al registrarlo, y hasta crear las parejas, el organizador define o edita sus inscripciones:

- Hombres: masculino, mixto o ambas.
- Mujeres: femenino, mixto o ambas.

No hay restriccion que obligue a que toda persona de una categoria propia juegue mixto. Una persona puede pertenecer simultaneamente a una pareja de su categoria propia y a una pareja de mixto, pero nunca a dos parejas de la misma categoria.

## Formacion de parejas

Para masculino y femenino, la aplicacion propone parejas antes de generar el cuadro:

1. Ordena los participantes inscritos por nivel, de 5 a 1.
2. Une el nivel mas alto disponible con el mas bajo disponible.
3. Repite hasta formar todas las parejas.

Para mixto, requiere la misma cantidad de hombres y mujeres. Ordena los hombres de mayor a menor nivel y las mujeres de menor a mayor, y empareja las posiciones equivalentes. Si hay excedentes, el organizador selecciona quien no participa en mixto antes del bloqueo.

Estos criterios compensan niveles altos y bajos y reducen la diferencia estimada entre parejas. Los empates se resuelven de forma estable. El organizador puede intercambiar integrantes, crear una pareja manualmente o ajustar las inscripciones antes de confirmar. Los ajustes manuales se permiten, pero el panel muestra la suma de niveles de cada pareja y advierte si se alejan de la propuesta equilibrada.

Al confirmar, se bloquean inscripciones y parejas. Cada categoria activa debe tener al menos dos parejas y una cantidad potencia de dos. Si no la tiene, el sistema explica que categoria debe corregirse o permite cancelarla. Antes del primer partido, el organizador puede volver a borrador mediante una accion explicita que elimina los cuadros y horarios pendientes.

## Formato deportivo

Las tres categorias se celebran de forma paralela:

- Masculino: parejas compuestas por hombres.
- Femenino: parejas compuestas por mujeres.
- Mixto: una mujer y un hombre por pareja.

Cada categoria usa doble eliminacion. La primera derrota desplaza la pareja al cuadro de perdedores; la segunda la elimina. Los campeones de los cuadros de ganadores y perdedores disputan la final.

La final tiene reinicio: el campeon del cuadro de ganadores llega invicto y se corona si gana el primer partido. Si gana la pareja que viene de perdedores, ambas tendran una derrota y se juega un segundo partido decisivo.

Todos los partidos previos a las finales se juegan a un set de nueve juegos. En 8-8, se juega tie-break a siete puntos. La final de ganadores, la final de perdedores, la gran final y su posible reinicio se juegan al mejor de tres sets, con sets a seis juegos, diferencia de dos juegos y tie-break a 6-6. En todos los formatos se usa punto de oro en 40-40.

Una categoria de dos parejas usa un cuadro reducido de doble eliminacion: el primer duelo es la final de ganadores y el perdedor debe ganar la gran final y, si corresponde, su reinicio para ser campeon.

## Cuadro, resultados y correcciones

Al confirmar las parejas, el motor crea una estructura determinista de doble eliminacion por categoria. Cada partido conserva sus destinos de ganador y perdedor; la final de reinicio se habilita solo cuando corresponde.

El organizador marca manualmente un partido como programado, en juego, finalizado o derrota automatica. Al iniciar un partido se registra su hora real; al terminar, carga el marcador por sets. Una ausencia o retiro es una derrota automatica: registra 9-0 en un partido corto y 6-0, 6-0 en un partido largo, junto con su motivo.

La operacion de resultado se guarda como una transaccion: valida el marcador, registra el resultado, asigna las parejas a los cruces dependientes y actualiza la programacion afectada. La vista publica refleja el nuevo estado en su siguiente actualizacion automatica. Si administrador y organizador guardan cambios incompatibles, el segundo guardado se rechaza para que recargue el estado actual; nunca se sobrescriben cambios silenciosamente.

Un resultado puede editarse solo si ningun partido posterior que dependa de el ha finalizado. Si ya existen dependientes jugados, el organizador debe deshacer primero sus resultados en orden inverso. Esto impide cuadros inconsistentes. Ningun rol, incluido el administrador, puede omitir estas validaciones deportivas.

Una sustitucion se permite una unica vez antes del primer partido de la pareja, respetando categoria, genero y ausencia de otra pareja de la misma categoria. Si una persona participa en dos categorias, el organizador resuelve manualmente cada pareja afectada. Tras el primer partido de una pareja, cualquier baja se registra como retiro.

## Programacion

El planificador usa como restricciones las canchas habilitadas, hora de inicio, hora limite, bloques cortos y largos, descanso minimo, dependencias del cuadro y participacion simultanea en categorias.

Al generar el torneo, asigna automaticamente los partidos iniciales a las canchas y bloques disponibles. Los cruces futuros se mantienen pendientes hasta conocer sus parejas. La posible repeticion de la gran final reserva siempre un bloque condicional despues del descanso minimo. Al cargar un resultado, el sistema asigna cada nuevo partido al primer bloque valido, sin solapar a ninguna persona en masculino, femenino o mixto. Entre partidos listos para el mismo bloque, prioriza el que desbloquea mas encuentros posteriores y, en empate, el que lleva mas tiempo esperando.

El organizador puede mover manualmente una cancha o un horario, pero no puede forzar solapamientos de cancha, participante o descanso. El sistema valida la modificacion y reprograma los partidos posteriores afectados. Nunca modifica resultados como consecuencia de una reprogramacion.

Si se deshabilita una cancha por clima, reprograma solo los partidos que no hayan empezado con las canchas restantes. Si un partido supera su bloque, usa sus horas reales y desplaza los pendientes. Si no hay bloque valido antes de la hora limite, permite programar despues de ella con una alerta explicita; vuelve a alertar antes de una gran final o reinicio que exceda el limite.

## Interfaz

La interfaz sera responsiva y orientada a operacion rapida desde telefono, tableta o portatil:

- Inicio de sesion por usuario y contrasena.
- Listado de torneos y acceso segun rol.
- Asistente de creacion y configuracion del torneo.
- Gestion de participantes e inscripciones.
- Revision de parejas sugeridas y ajustes manuales.
- Tablero operativo de partidos, canchas, horarios y carga de resultados.
- Pagina publica con horarios, estado de canchas y cuadros de ganadores y perdedores de las tres categorias.

La pagina publica se habilita al crear el cuadro: muestra "proximamente" antes de iniciar, el avance durante el torneo y el estado final o cancelado despues. Consulta actualizaciones cada 30 segundos e incluye un boton de actualizacion manual. Muestra los nombres completos de ambas personas, los marcadores y una etiqueta de ausencia o retiro cuando aplique. Administrador u organizador pueden regenerar el enlace en cualquier estado; el anterior deja de funcionar de inmediato.

## Arquitectura tecnica

La solucion es una aplicacion monolitica web desplegada en Railway:

- Next.js 16 con TypeScript y App Router para las paginas del panel y la vista publica.
- Logica de dominio y validaciones ejecutadas en el servidor mediante acciones del servidor y manejadores de rutas cuando sean necesarios.
- PostgreSQL administrado por Railway como base de datos persistente.
- Drizzle ORM para esquema tipado, consultas, transacciones y migraciones SQL versionadas.
- Autenticacion propia y minima: tabla de usuarios, hash seguro de contrasena, sesiones revocables, cookies `HttpOnly` seguras y limitacion temporal de intentos fallidos por usuario e IP.
- Docker Compose para reproducir localmente la aplicacion y PostgreSQL durante el desarrollo. Railway usara servicios separados para aplicacion y base de datos, no Docker Compose en produccion.

PostgreSQL almacena usuarios, torneos, canchas, participantes, inscripciones, parejas, partidos, marcadores y estructura de cuadro. Las operaciones que hacen avanzar el torneo se ejecutan en transaccion para evitar estados parciales o conflictos entre administrador y organizador. Un organizador puede tener varios torneos, pero cada torneo tiene un solo organizador asignado; antes de desactivar una cuenta, el administrador debe reasignar sus torneos activos.

La aplicacion se desplegara desde el repositorio en Railway. La configuracion sensible, incluida la cadena de conexion y la clave de sesion, se definira como variables de entorno. Se generara una copia de seguridad logica de PostgreSQL antes y despues de cada torneo con `pg_dump`; se conserva durante 30 dias y despues se elimina automaticamente.

## Validaciones y errores

El servidor rechazara y comunicara de forma clara:

- Acciones sin sesion o con un rol no autorizado.
- Niveles fuera del rango de 1 a 5.
- Usuarios o contrasenas que no cumplan la politica de credenciales.
- Inscripciones incompatibles con el genero o parejas incompletas.
- Personas repetidas en una misma categoria.
- Categorias con cantidades de parejas que no sean potencia de dos al generar cuadros.
- Marcadores que no cumplan el formato corto o largo correspondiente.
- Horarios que solapen participantes, canchas o incumplan el descanso minimo.
- Modificaciones de partidos ya iniciados.
- Cambios de resultado con partidos dependientes ya finalizados.

Una validacion fallida no altera los datos. El panel muestra el motivo y la accion necesaria para continuar.

## Pruebas

- Unitarias: algoritmos de parejas propias y mixtas, validaciones de marcador corto y largo, avances de dos parejas, ganador y perdedor, reinicio de final y programador de horarios.
- Integracion: transacciones de resultado, reglas de acceso, restricciones de inscripcion, bloqueo de correcciones inconsistentes, control de version y reprogramacion por retraso o cierre de cancha.
- Extremo a extremo: crear torneo, registrar participantes, confirmar parejas, generar cuadros validos y categorias canceladas, operar resultados, sustituir antes del primer partido y comprobar el enlace publico sin inicio de sesion.

## Fuera de alcance

- Registro o inicio de sesion de jugadores y publico.
- Correo electronico, recuperacion automatica de contrasena y notificaciones.
- Pagos, inscripciones en linea y cobros.
- Historial, estadisticas, ranking o perfiles de jugadores.
- Mensajeria, chat y streaming de resultados.
- Funcionamiento sin conexion.
