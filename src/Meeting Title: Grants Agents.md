Meeting Title: Grants Agents
Date: Mar 26
Meeting participants: Gino Cingolani, Gino Cingolani

Transcript:

Them: Te veo lo que es lo que me imagino yo como flujo. O sea, vamos primero al flujo y después vamos al al al diseño más de de de de prompting y de contexto. Pero el proceso para mí debería ser bastante simple, o sea, el input es un Google Form. El Google Form va a llegar a un sheet donde van a estar todas las respuestas. Ese sheet debería alertarnos cada vez que haya un nuevo, digamos, una nueva submission, en un canal de Slack, y debería el proceso de evaluación. El proceso de evaluación tiene digamos, una etapa previa que es la etapa de rápido, si la propuesta tiene todos los campos y no está, tipo, si no una cosa troleada, o sea, como que eso hasta podría ser manual, es tipo mirar un poco y ver ver qué qué tipo tenga todo lo que tiene que tener.
Me: Es de decir, o sea, el el la el primer coso filtro es nuestro, es tipo, che, arrancá, más que nada por también, o si nos mandan falopa o si nos mandan como, che, hay que robar todo,
Them: Bueno, por eso por eso yo lo lo pensé como bastante como en en que esté tipo cada cosa tenga como su cámara, su Ponele que ponele que el el primero es tipo una evaluación rápida, que dice si si se publica o no se publica. Eso, tipo, si tiene todo lo que tiene que tener uno. Si eso pasa, ese sheet deberíamos, de alguna manera, convertirlo en una project submission que se debería ver en el dashboard de projects de que tenemos ahora. Puede ser eso, o por ahí es más fácil decir, no, boludo, pará, al codigamos un landing y lo hacemos el otro lado, whatever, vemos. Pero
Me: Sí.
Them: bueno, por eso, o sea o sea, y reemplazamos esa tab, no sé, vemos cómo hacemos, digamos, pero en algún lugar donde sea público. Nosotros lo que teníamos antes era algo que, cada vez que un un proyecto se publicaba, en en en, como en la plataforma de gobernanza, un proyecto era un una proposal de grant votada aprobada, y eso, automáticamente, crea un proyecto en en la base de datos. Y el proyecto lo que tenía era un thread de foro creado automático. ¿Sí? Tipo, grand submissions, y cada vez que se crea, digamos, que se aprueba una submission y se hace pública, aparece en el foro. ¿Por qué aparece en el foro? Porque el foro es la manera de hacer comentarios sin tener que tener un sistema de comentarios mantener un sistema de comentarios nosotros. Sea, todo pasa por el foro. Entonces, me parece que es la mejor manera, o sea, es una paja en un sistema de comentarios, boludo.
Me: Queremos que
Them: O sea, es como todo todo es buscable, todo está ahí, o sea, yo usaría el foro como como como knowledge base.
Me: Sí, lo que también lo tiene follows que tenés el doble usuario, ¿oíste?
Them: Digamos. Lo del usuario, sí. Bueno, eso lo lo tenemos más o menos resuelto. No sé si irá funcionando, pero podías linkear tu usuario del foro con tu usuario de
Me: Okay.
Them: de de, digamos, de gobernanza, y aparece con tu, el nombre de usuario bien. Eso, digamos, está. Lo habíamos lo habíamos solucionado. Entonces, se publica el En el momento en que se publica el ahí es donde entra el proceso de evaluación. Digamos, o es en el momento en donde se puede hacer visible el proceso de evaluación. Es digamos, tenemos cuatro agentitos que tienen como una, digamos, un distinto, un contexto, que por ahí el contexto es el mismo, no sé, pero por ahí el contexto debería ser distinto para que sea más fácil diferenciarlos. No sé. Y se enfocan en cuatro, digamos, criterios diferentes. Lo que hacen es leer la leer la propuesta, hacer un comentario y hacer preguntas. ¿No?
Me: Sí.
Them: Esas preguntas nosotros deberíamos aprobarlas, con lo cual deberían esto debería ser un lugar en donde, que ocurra en en un en un channel de Slack o en algún lugar en donde simplemente diga, che, tipo, voy a publicar esto, pum, tas ok, sí o no. Y que se publique. Y entonces, el diálogo, digamos, pasa en el foro. Hay como un ida y vuelta ahí, y en algún momento, digamos, ese agent hace una recomendación, che, proyecto está bueno, el equipo demostró que, no sé, que ya hizo cosas en blablablá, lo que sea, está bueno para fondear, o yo considero que no hay que fondearlo,
Me: Eso es interno nuestro.
Them: eso es interno nuestro, o sea, como todo es interno hasta que nosotros lo publicamos. Como todo es tipo de evaluación y nosotros lo Y una recomendación. Y después de esa recomendación, listo, tipo, domain location, pum, sí, no, cantidad de plata, y ahí sí ves, va a haber un proceso un poco más manual de follow up, de de los de los
Me: Sí, porque también le podés poner un bot con un Chrome que le espingué editó la bola.
Them: Sí, o que o que tengan que todos los días
Me: Sí, sí.
Them: que todas las semanas, tipo, cuando lo hicieron, no sé qué, whatever. Pero bueno, trabajar ahí en en en esa como vista un poco de road map, y que digan en los momentos en los que
Me: Sí.
Them: digamos, define los momentos en los que recibían pagos.
Me: No, lo que hay que ver, yo creo que lo lo haría con un projects nuevo, o trataría de ver capaz de robar cosas y meter un servidorcito nuevo? Porque el que está hoy es inmantenible, la verdad.
Them: Okay.
Me: Está con Gatsby, se consume toda la memoria, de repente los crons no dejan de acordar, ¿viste?, lo que nos pasaba, que hay que porque los proposals no se creaban. Y hoy hoy con Cloud, en un prompt, tenemos el servidor corriendo con nuestro con lo que querramos.
Them: Sí.
Me: Después lo de los ages, es un Clautonio
Them: Claro, o sea, sí. Tiene que, o sea, tenemos que tener el pipeline armado para que puedan publicar en el foro, digamos, o sea, tenemos que crear como unos usuarios
Me: Sí. Sí.
Them: del foro, y cada uno tiene un perfil
Me: Eso, le hacemos cuatro usuarios diferentes los agents.
Them: Claro, Sí, sí, venían a ser cuatro soles distintos.
Me: Ok.
Them: Cada uno tiene como su su perfil, y y nada, y publican, digamos, con su usuario. Tienen una del foro y publican con su usuario.
Me: Y la otro es ¿qué data tenemos que tener en cuenta para armar como todo el contexto de los de los agentes?
Them: Ok. Yo lo que lo que probaría sería hacer el pipeline digamos, pensar en como el los pasos de implementación del pipeline, teniendo un agente definido, que me parece que va a ser el más fácil que es el agente técnico, que es, básicamente, o sea, alguien que tenga contexto del SDK, tenga contexto de protocolo, que tenga contexto de de cosa se puede hacer y qué cosa se puede hacer, y que si alguien viene y dice, bueno, voy a hacer un juego no sé, un FPS con instancias, le digo, che, mirá, no, no sé si va por acá.
Me: Bien.
Them: Sea, como que que sea un poco más opinionated desde ese lugar,
Me: O sea, todo el contexto ese lo tenemos. De hecho, ahora me puedo evaluar lo que hicieron los de foundation, que metieron todo el contexto de de Unity, de work content server, de Catalyst, layers,
Them: Claro, como, tipo, todo eso medio agrupado y que digamos, que a mí sí me los entienda que que sí. Obviamente, nada, el el el todo debería pasar por un check, ¿no? Sobre todo, al principio, todo tiene que pasar por un check, con lo cual, de última, si bardea bueno. Bardee,
Me: mismo el el el check, mí tiene que ser un thread de IO, de de Slack nuestro,
Them: Eso,
Me: y que nosotros lo podemos acompañar, como tipo, che, mirá, fijate, esto me acá, para mí va por este lado y que se se
Them: Sí, poder tirarle y que vaya, es
Me: Sí. Así llegamos a la
Them: sí. Claro.
Me: la a que mande él el mensaje después directo con con lo que
Them: Un poco de ida y vuelta.
Me: Pero después la la, o sea, ese contexto está bien, lo tenemos fácil,
Them: Sí.
Me: Yo digo el contexto más de grands pasados, y cosas que y todo esto
Them: Bueno, después claro, hay cosas que para mí son contexto general de todos los agentes, ¿no?, y después hay contexto específico. En contexto real, yo estaba pensando, pensando en el tema de de estatus updates de otros proyectos, de comentarios de gran super squad, todo eso está, vive en Notion, tipo, lo tenemos, El tema es, cuál sería la mejor manera como de exportar, ¿qué sería? Tipo, un MD gigante, tendríamos diferentes diferentes, tipo, ¿Cómo? Sí. Igual, recomen que se va que sea un poco de trabajo manual, no pasa nada, lo hacemos, pero
Me: que es es notion con super... Consume notions. No, sí, sí. Pero más que nada entender, o sea, si es un notion gigante, vos o
Them: No, cada proyecto es una página no
Me: cada proyecto es un Ocean, Ok. No,
Them: dentro de Notion de la Podríamos, o sea, no, podríamos exportar, no tenemos que exportar todos, ¿entendés?, podríamos exportar algunos, cómo podemos ver cómo cómo encararlo.
Me: Habría que probar. Como como está hoy, le tiramos a la dicen, tipo, che, mirá, te estos estos MDs, de todos los proyectos, buscá cosas relacionadas y ver cómo responde. O sea, se va como unos buenos tokens, pero la verdad que los tokens nos chipan huevos, están Si enfocado en esto, no es que lo tenga que hacer todos.
Them: Sí, sí, obvio, en Cuba. No,
Me: Como que hacemos uno en find previous grants.
Them: ouais. Alright.
Me: Y cada vez, con todos los MDs y vos qué cosas relacionadas.
Them: Bien.
Me: Podemos probar eso de QMD, de última. Que es el query markdown. Que
Them: Query markdown, no sabrías, o sea, para markdown.
Me: Que, de hecho, OpenClaro tiene hecho, todavía no se lo activé. O sea, en vez de usar una base de datos con vector embeddings,
Them: Claro.
Me: usás los directos,
Them: Directamente.
Me: y después por atrás le puedes poner uno uno de la mapa para que haga embeddings a los MDs, si querés. Pero, si no, también lo buscas directamente a los a los MDs. Nada, podemos probar. Puedes uno dedicado a a find previous
Them: Sí.
Me: grants, lo podemos hacer. O no lo haría con todos, pero sí, como primer paso.
Them: Okay. Bien. Y después, en cuanto a los skills de digamos, los skills que son como más generales estaba pensando que podríamos qué podríamos usar. Viste que pasamos, ahí yo les pasé a los chicos, después a vos pasó, como algunos repos que tienen agentes de como MDL, o y qué sé yo, tipo ponerme a buscar ahí, digamos, qué contexto usan los perfiles y ver si podemos usar algo parecido. Tipo, bueno, gameplay, ¿entendés? Claro, ¿qué qué busca un qué busca digamos, qué qué tiene en cuenta para analizar algo así o para desarrollar algo así, por ende, analizar una propuesta un agente que, digamos, que tiene skills de gameplay y m design. Lo los más fáciles para mí son los de como de marketing, y como eso es más fácil, y el de el técnico, eso dos son los más fáciles. Después, los otros dos, me imaginé que son como creatividad y arte, y qué sé yo, Y y gameplay y mechanics, esos dos me resulta más difícil de pensarlos, pero bueno.
Me: Sí. Pasa que, ¿cómo lo evaluás? Mediante un form también, como que es medio difícil. Porque
Them: O sea, evaluás evaluás el form y después haces preguntas, o sea, las jodas hacen las preguntas.
Me: bien.
Them: O el form, lo que te dispara son preguntas. Y que la otra persona responda las preguntas en base a esa propuesta inicial.
Me: Caro. O sea, vos podés hacer el form, el fondo que queda la proposal, y después es como un ida y vuelta de millón de preguntas.
Them: Bueno, sí, eso es algo que tenemos que firmar, que es un eWelt eterno.
Me: Claro.
Them: Pero que haya, digamos, un, sí, que haya no sé, ponele que haya hasta bueno, tres ías y vueltas de preguntas y respuestas, ¿entendés?
Me: Ok.
Them: Cada uno de los agents, por favor. Eso inclusive se lo podés decir, mirá, tenés tres, tipo, tres idas y vueltas con con el supuesto R and D. Ese es
Me: Sí, si no, el auto no no
Them: Claro, claro.
Me: todo el, crea, con todo lo que quieras.
Them: Claro. Y ya.
Me: Sí, o sea, la gente, juntémonos con Toxic, con toxic, con toxic, a ver si podemos crear una skill o algo de de esto, o sea, cómo Y tirarle propuestas medio falopa y buenas, o tirarle capaz de grumpy, y ver
Them: Sí probar algo o pensar algo de eso, como hacer un par y ver, es que, bueno, lo bueno es que tenemos dos o tres que podemos usar, para tirarle, para probar, ver cómo cómo funcan. También podemos crear un par de proposals palopa,
Me: y
Them: y ver cómo ver cómo funciona. Al final, la gente va a hacer eso mismo.
Me: cien por
Them: O sea,
Me: el playtest, un playtest puede ser, crear cosas followpas hasta romperlo.
Them: Claro.
Me: Sí. Y el que el que que se la aprueba se gana un nombre.
Them: Claro, sí.
Me: Claro.
Them: Después otra cosa que que pensé, porque, digamos, nosotros, o sea, el digamos, los tenemos dos tracks, ¿no?, como un track de tooling más técnico, tooling, y otro track de contenido. Sea, escenas. Como los dos tracks que tenemos. Lo que yo pensaba es, el, digamos, el la recomendación de de de de fondear o no fondear un proyecto, deberían tener en cuenta, digamos, lo que los cuatro agents recibieron como contexto en la en la pregunta y la respuesta. O sea, digamos, la recomendación debería ser unificada.
Me: Bien.
Them: Debería ser debería haber una recomendación, ¿no?
Me: Tenemos un agent de de decisión final,
Them: Bueno, o puede ser un agent de final, o que entre ellos cuatro, digamos, definan algo.
Me: Sí. Hay que ver, me tengo que sentar a pero si los cuatro agents viven en el mismo servidor, pueden vivir de separados, pero si tengo como la de cada uno con todo lo que fue pasando, después yo puedo tener una una agent, tipo, che, leté estas cuatro conversaciones y llega algo final. O que le pregunte a los cuatro agents, tipo, que haga como coordinador
Them: Claro. Y ahí ponele, para las cosas técnicas, el agent de digamos, para el para el track de como tooling y cosas así, si aparece algo, el agent técnico debería tener digamos, preponderancia en la decisión final, y en el track de contenido el agent, por ahí más de gameplay, y de, o sea, bueno, debería debería ser un poco más distribuido, ¿no? Como en uno debería uno debería tener más preponderancia que en otro. Eso, lo Pero bueno, eso también podría ser medio en el en el prompt.
Me: Ajá. Sim, troémoslo, o sea, vayamos enterándolo. Creo que puede ser un agent al final que que tire todos los, o que tenga las conversaciones pasadas o que interactúe con los
Them: Todo el contexto y
Me: O que le le haga preguntas acá a como...
Them: Bien. Bueno, y otro tema.
Me: Me está diciendo esto.
Them: Hay otro tema que es importante, que es Y esto, me doy cuenta que tendría que tendría que que ponerlo en el form, Como el el agent tiene que hablar con una persona, o sea, tiene que darle bola a una persona.
Me: Sí.
Them: En el
Me: Claro, el el, vos te te voy a poner en el foro, en el informe, ¿quién es el lawner?
Them: ¿Quieres el owner? O sea, ¿qué tipo es? Sí, eso lo voy a hacer ya.
Me: Sí.
Them: Porque porque, si no, no sé a quién, o sea, a quién pija le habla. Ok. Entonces, en el form, Okay. Porque la porque el Fred en el foro, no lo va a crear una persona. O sea, no lo van a crear ellos, lo vamos a crear nosotros automáticamente en el foro.
Me: Sí.
Them: Entonces,
Me: Hay que poner que sea el loner del foro o que te, Ahí volvemos de vuelta a la bidireccionalidad de los que tenés y tenés foro usuarios.
Them: Ah, bueno, no importa, pero porque el el el nombre de usuario del foro es el nombre de usuario del foro. O sea, el informe es, che, poné
Me: Eso.
Them: ponè tu dici il forum username, importante, tipo, esto lo tenés que poner bien,
Me: Ok, pon las dos
Them: el diálogo el diálogo de la evaluación se va a hacer público en el en el Eso. Ok.
Me: Bien,
Them: Bien,
Me: encaramos esto en tiempos.
Them: ¿Cómo ganamos esto en tiempos? Toxic está preparando todo para empezar a recibir o sea, para anunciar lo de los grants Ahora, o sea, ahora, tipo, el viernes. O sea, publicarla, que esté la landing publicada y qué sé yo. Va, anyway, le, en el landing tiene auto deploy cuando me a a master.
Me: Amén, sí, si querés lo de los te lo tengo que editar, pero sí.
Them: No, bueno, está, que por lo de preview, no, no importa, mira el local ya fue donde había salido un importante.
Me: Sí. Sí, sí.
Them: Ok. Porque tengo de local un par de cositas así.
Me: De hecho, igual te voy quitar el así te queda, burdo.
Them: Ah, dale, sí.
Me: Por
Them: Sí. Al final, ¿qué qué estamos usando?
Me: Mateo tenía uno que se usaba para Diesel Explorers, En su momento, cuando hacían Creo que ahí tenían los Los asset bundles que usan ellos, no sé, tiene un par de cosas. Y él me había pasado la cuenta para que empiece a pagar yo, pero como todavía no está pagando nada, en el free trial, no puse mi tarjeta de crédito. Pero, bueno, ya está la cuenta creada. Y tenía hasta el dominio este de Diesel Explorers. Y lo que hizo fue No pasé el dominio porque me dio cagazo. Porque estamos dando, este, estamos dando
Them: Squarespace, sí, al dominio.
Me: Con el dominio. Y ya tiene un montón de cosas de Google, las cuentas de Google, y dije, prefiero no pasarlo. Por eso tampoco hice lo de el, con el paz.
Them: Okay.
Me: Le puse los los paths acá, migrants, transparency. Y a la mierda.
Them: Bien.
Me: Y acá, en el este, en el hay un Pages, que está acá, landslending. Y está con el conectado
Them: Okay.
Me: Y está conectado al
Them: Sí, sí, está bien, pues, queda así.
Me: Sí, o sea, no no me quise meter un quilombo de Uber. Si rompo Uber, no estoy para
Them: Decís, los DNS, toda la falopa esta, que es una baja.
Me: Los DNC son cosas que, si está todo bien, está todo bien, pero si rompiste uno, te podés volar loco.
Them: Sí.
Me: Y me
Them: No, me encanta, porque me encanta porque es, tipo, el límite del mundo, o sea, los DNS son lo, cercano al mundo real de Internet, o sea, eso me encanta, boludo. Hace un par de años me obsesioné con me obsesioné con una niña, que en los setenta era la bibliotecaria, que mantenía los nenes. O sea, todo existe universitario de Estados Unidos, y era una mina ahí, tipo, era tenía su libro de domain name record, tipo, tenía el coso.
Me: Hermoso.
Them: Y era un cuaderno, y claro, a ella la llamaban, y es, entonces, ya tipo, asignaba un coso, y lo ponía en su cuaderno, y y y tenía que mandar una carta a toda universidades de tipo, che, bueno, ahora esta dirección la tiene en la Universidad de Michigan, de no sé qué, y claro, tardaba en llegar, o sea, y es como muy precioso.
Me: Ahora, eso es otra, tipo, la IA toca comer laburo, y antes, la computadora, comer laburo.
Them: O sea, qué se yo. Sí, como
Me: Sí, es algo más o...
Them: Es muy guay.
Me: Es hermoso, y la gente, y es algo que es super y la gente no lo entiende. O sea, lo entendemos nosotros que que estuvimos al que que estamos en el mundo, pero no sé, yo le hice el open cloud, que lo, le hice una un grupo de amigos que crea una página del que me hizo la casa. Checa, hazme una página de arquitectura, para mi perfil, bueno, tomá, hablá con mi hablá con mi asistente, la va a hacer. O sea, tiene la key de Vercel, sabes cómo es player. Con él, que te la hace. Y se la hizo toda, y también, o sea, le puse un domingo, no la movía, fue como, uf, esto era era imposible que yo lo puedo hacer. Como no entienden. Y sí, obvio, ya se
Them: Sí, sí, no, no, es que es es que es muy lindo. Pará, mirá, te voy mostrar algo que tengo. No. Este libro, ¿Dónde viste? Voy a vender el foco. Ah, Este libro, es espectacular, es como
Me: How it works. Mira,
Them: es como medio, digamos,
Me: ¿Cómo te lo explica?
Them: para niños, pero no para niños, o sea, es recontra técnico, Y no, no, y tipo, mucho dibujito y qué sé yo, pero te explica absolutamente todo lo que Sí, sí, lo que es un paquete, cómo cómo se Sí, sí, es que sí. Tipo, peers, y XP, cómo funciona TCP, es muy, muy, muy, muy bonito, Bueno, nada, criptografía, lo que es un token, lo que es tipo... Nada, y siempre que siempre que que como que hablo de de con alguien de esto, leo tipo, ¿cuántos de todos estos contexto, digo, de estos conceptos conoces? Y la verdad es que la mayoría de la gente
Me: ¿Algo más? Un la biblioteca. Como
Them: ninguno, o no sé, es cero, ¿me entendés?, o ni idea. Hay gente que
Me: sí.
Them: que que que por ahí que hasta inclusive trabajan algo que tiene que ver con tecnología de alguna manera, Nada, es muy es muy, este, sí, hace parte de la aparte tipo, carraduras, como gorditos. Bueno, a ver, entonces, ordenémonos con la con todas las, digamos, con todo lo que hay. Nosotros o sea, cosas que que requieren de de trabajo digamos, de trabajo técnico real, hands on, que tienen que ver con tu con tu tiempo, tenemos lo de Upendiciel, que es una cosa, ¿Qué más tenemos?
Me: Con lo que yo estoy, open decidel, Clau Toño,
Them: ¿Plautonio?
Me: esos dos. Pasa después, al menos, todas todas soportes de cosas.
Them: Está todo eso aparte, eso está de acuerdo. Y después tenemos algunas cosas que no son técnicas, pero que requieren también un poco de tu tiempo, que son que estemos abiertas. El proceso de, tipo, advisorship o de como que queramos llamarle, de tipo técnico con foundation, esto que habla de tipo tener un espacio con Jimmy o lo que sea, como para como para que que nuestra voz esté de alguna manera representada, Y después lo de engineering, tipo, como la parte más de operational excellence, ingeniería, tipo, como ayudar a al equipo que la aure mejor. Y ahora tenemos esto. Son un montón de cosas.
Me: Tengo que agarrar una en el medio.
Them: Entonces, Ok.
Me: Esto pasa cuando no puedes dormir. Y te quedas hasta las cuatro de la mañana, porque soy mi cara de muerto, ahí, pasando bufala mañana. Ahora no lo tengo, pero está el Le agregué, ¿viste?, trabajo que había hecho en su momento. Le
Them: Sí, sí.
Me: atrás, y, no, todo funcionó. Ahí. Acá tenés el, con clic en el doors, you'll open it. Take it. Con todo el código, los modelos, Ahora también está ahí un poco la modelos. Y está todo lo del principio de atrás, con todo con Podman, no me estás respondiendo a la AI, y no entiendo por qué creo me quedé sin tougments. Y le metí todo con Docker, por atrás con Podman, para pero yo hablo en un servidor y que cada uno tenga su solo su contexto y no puede acceder a otras cosas. Y nada, es como el open decide él, pero web, y por atrás usa
Them: Pero lo que está corriendo de fondo es OpenCL, o sea, es, tipo,
Me: Sí, le hice una
Them: es el modelo.
Me: le hice una versión headless, que no, ve tan ninguna extensión de ni screenshot ni de preview ni nada, sea, que
Them: Ajá.
Me: solo y sepa que haga escenas.
Them: ¿Y qué te acaba de hacer?
Me: Y nada, ahí usa todo el el modelo de cloud code subscription para atrás, los tokens que vamos a usar son lo que paguemos de max, digamos, doscientos dólares. Y después se lo podemos dar a, no sé, a los que tienen words. Y ver cómo funciona. Entre nosotros. Pero ahora que ese modelo,
Them: O sea, pudieras loguear, que tipo te pudieras loguear con tu name, ponele, o bueno, no sé, con fija sea,
Me: hecho, eso ya está.
Them: y que si tenés un name, te des acceso.
Me: No tengo. Pero bueno, o sea, acá. Todos los Pero ya está, ya te vi todo lo de out, o sea, con mi wallet.
Them: Y también puede
Me: Es, mirá.
Them: Porque, o me, o sea,
Me: Competition por el lo que voy a hacer es
Them: open DCL sí puede ployar. ¿O no?
Me: que haga el deploy en el servidor y le mande el el hash para firmar, lo firmás, y se lo ingresa al servidor. Hay que hacer como una... Es como cuando haces deploy, que te abre un browser y deployás,
Them: Sí.
Me: lo mismo acá. Así que sí, deberías poder. Está en el futurista. Pero bueno, o sea, el tema es que ayer dije, pará, yo ya como que del hace dos meses o tres meses, no sé cuándo fue, octubre, noviembre, cuatro meses, que había hecho esto, fue como, che, pará, creo tengo todas las missing parts que faltaban, de que no por qué no había funcionado, de, no sé, agregar modelos de, si hablamos modelos, y lo tenés acá, ahora también los voy a poder
Them: Ella le
Me: En referencia al modelo, sabe cómo crear modelos, y además se
Them: le referencias el modelo directamente.
Me: abre el arreglo del editor, también puedo mover los los modelos de acá. Como que tenés todo
Them: ¿Sabe cómo crear modelos o cómo sabe cómo crear modelos?
Me: no, pero todo el
Them: O sea, ¿sabe ¿sabe trae los modelos del del, claro, open decir él.
Me: cómo... Nada, che, adador modeling, I would use the wood mod. Ta ta, download, update it. Ya está el código. Y es como le le di una visualización de la appendix ideal para la gente que no... Porque me cuenta que la gente no se usa la terminal, Eli no sabe, Cino no sabe,
Them: No.
Me: nadie sabe.
Them: No, igual la gente que hace cenas, sí sabe algo, sabe.
Me: Sí, sí, pero ¿cuántos hacen escenas? Diez.
Them: O sea, son diez. Sí, sí, es cierto, es cierto, sí, sí. Bueno, mirá lo que yo te decía como algo algo como low code que sea esto y que vayas
Me: Y lo que le hice fue,
Them: jugando.
Me: mirá, tengo este este que es el que hiciste vos, que que tiene un montón de componentes,
Them: Sì,
Me: fui como, che, usame todo el design system, de esto no tengo ganas de pensar un design system.
Them: Claro.
Me: Y generaba otra
Them: No, de hecho, ni siquiera, pero pará, mejor, más que componente, si vas a, andá al porque lo que yo le pedí es quedarme con un, andá al al no, no, al root. Esta es root. No, ahí, design spec MD. O sea, yo lo que hice, lo primero que le pedí es, tipo, che, armate sea, le pasé el Figma y le dije, armate un design spec.
Me: Bien.
Them: Y, entonces, agarró y fue, tipo, como fue bajando de todo lo que veía, digamos, del design spec. Y después, bueno, obviamente, lo fue bajando acá a una de las secciones,
Me: Sí.
Them: pero arriba de todo, o sea, toda la primer parte es el design spec de regency labs, tipo, no sé, los gradientes, los colores,
Me: Hermoso.
Them: la tipografía, tipo todo. Tipo, hasta ahí, tipo, todo eso es como
Me: Ajá.
Them: todo es un spec de diseño. Sí, está bueno. ¿Cómo que te ha armado que tiene sentido?
Me: Bien.
Them: Bueno,
Me: Ah, pero eso ya, como que le open seller, eso es como es un es una cosa más grande capaz. Eso es todo.
Them: Sí, sí.
Me: Però stai?
Them: A mí acá me pasan cosas, o sea,
Me: Está ahí.
Them: me pasa. Un lado, que Digo, che, le le podríamos podríamos, tipo, agarrar a Roy y decirle, che, a ver, labure, o sea, que que se ponga a laburar con vos en esto, que no sé si si está para hacerlo, pero digo, como che, hagamos como un spike de de, no sé, de dos semanas, ¿entendés?, que no estés codeando baby. Sino que estés laburando en esto, con Gon, y que, o sea, que vos no estés codeando y que él pueda avanzar con cosas
Me: No, a ver, yo creo que necesito mano de bebies seguro, porque yo estoy haciendo medio hacks para que todo esto funcione. No sé, cambiás algo, yo estoy haciendo un word directamente a mi servidor. Que cada vez que cambiás una cosa de código, un nuevo con toda la con todo el context hash nuevo de las cosas. Y ¿viste? Como que Más o estaría bueno que sea directamente desde baby. Tipo, che, cambiame algo, que le puedo mandar una instrucción y me cambie el y no te hacés el Hay un montón de cosas, no sé, mismo cuando entrás, Por eso decía, de que si Baby lo empezamos a enfocar más a creators to link, no sé.
Them: Sí, sí. Sí, yo el otro día estuve estuve haciendo como, estuve ahí hablando con Claude, viste que está todo de hype de Three JS, que es como que todo es tipo, Three JS, Three JS, Three JS, y estuve como tratando de entender, che, bueno, ¿qué tipo, qué tiene...? Entre baby y three j s, digamos, qué qué cosas nos faltan, cosas tiene y qué sé yo. Y digamos, mi interpretación es, ok, Baby tiene una filosofía muy parecida, es en otro estadio de desarrollo, claramente, o sea, que faltan un montón de cosas que Triggers tiene, pero desde el punto de vista de de la filosofía, es bastante parecido Entonces, siento que, nada, que que que se repodría encarar algo está duele esto. Me pasó lo mismo ayer, tipo, me colgué con eso y fue, tipo, che, qué mierda hacemos con Baby, qué sé yo, y dije, bueno, a ver, tipo, el el hype de developers haciendo esto,
Me: Sí,
Them: como que o sea, tiene sentido lo que estamos diciendo. O sea, no es una... Que con Unity, ¿entendés?, no tiene sentido. No sé, con Unreal no tendría sentido, o sea, con esas cosas no tendría sentido, Con esto digo, bueno, tiene sentido que la la la el tooling, digamos, de crear una escena
Me: Sí.
Them: digamos, no, sea así.
Me: Sí, y para y para mí, o sea, con Raúl, que puedo laburar es estas dos partes, hoy se conectan solo con si vos te fijás, esto es un a frame, un iframe con, le pega a mi servidor, como tipo, che, esta es la cena. Que estás que estás corriendo. Bueno, toca ir ahora. Pero, o sea, ¿estás te acuerdas esta escena? Capaz tenemos conectar las dos cosas, y no sé, si vos hacés clic acá y querés moverlo o editarlo, que tengas HotReload directamente atrás, no tengas que hacer un
Them: Claro, no estoy todo el tiempo, tipo, cargándolo.
Me: hice récord, no puedo hacer eso. Por eso es como... Sí. Si queremos, voy a puesto este lado, para mí es un un re go. Y se te pasó, o sea, cosas faltarían? Un buen catálogo de modelos, y que los puedas ver, visualizar acá y ver acá, como tener un tab de acá modelos, y, tipo, cheque ahora este
Them: Sí, sí, está como visual.
Me: Claro, y me lo agrega. Después, la parte de promptear funciona bárbaro.
Them: Sí, sí, la parte de preguntar es, tipo, es el modelo, como
Me: Funciona bárbaro. Si tenemos alguna lista de modelos para tirar acá de Arévalo del Editoring Work, que podés escalar las cosas a posicionarlas, y todos se comunican entre sí, y no solo un iframe que levanta una cosa, salido del lobabel. Y después es agregarle los cosas por tokens o no sé, como quieran, como queramos hacerlo.
Them: Sí.
Me: De hecho, por atrás tiene toda la parte de Podman para que es como un que estén aislados los por user, todos los los proyectos, y la LLM no la cabe, Età, el to do list. Multisense support, textaria, deployed flow, departure low niche derotion, token metering UI, show balance,
Them: Yeah.
Me: Es como habla de open para developers y open para No
Them: Sí, sí, sí, para alguna cosa más.
Me: Ajá.
Them: Bueno,
Me: No sé, a mí me, ayer me copó y me quedé posta viendo el dije,
Them: Claro, yo lo que diría es, a ver, tenemos o sea, no vas a poder hacer todo junto. Entonces, esto me parece que está bueno que siga avanzando, O sea, me parece que que es copado, que es que es tío.
Me: Yep.
Them: Yo tendría una conversación con Rob y le diría, che, tipo, con esto, tipo, estoy, se va con esto, estamos viendo que está bueno, Yo ya un poco le tiré idea cuando tuve la uno a uno o no, pero y también un poco lo lo lo estuvimos diciendo así, pero es como, che, que Bebi tiene un potencial muy grande, para, tipo, sin creators, porque lo te hacés un spike de laburo y me ayudás en estas cosas, tipo, y le bajas una lista como de tareas, y mientras él labure en eso, hacemos lo de los grants. Que las dos cosas y el soporte a todos los equipos, o sea, no vas a poder Yo digo, para que siga habiendo para que siga habiendo movimiento, el open DCL, o sea, que sigan pasando cosas, pero que vos no no es que por, eso, por dos semanas no estés, tipo,
Me: Ok. No, no, tengo que empezar a sacar cosas.
Them: clavándote ocho horas codeando eso a las cuatro de la mañana.
Me: No, no, seguro. A mí lo que pasa con esto de open diesel es que para que algo mostrable, creo que es más de mi lado que el de Rob, porque con lo que está hoy en día, con lo de Rob puedo vivir, sí podemos mejorarlo. Le puedo decir como eso, como, che, ¿cómo podemos hacer conectarlo de último? Pero siento que si queremos mostrarlo al público, no sé si lo puede meter en todo lo que es la parte del servidor, digamos.
Them: Bueno, pero que te ayude, o sea, que que te ayude, por lo menos, en en prolijando Baby.
Me: Sí, sí, pon solo. En eso sí. Igual, o sea, es dedicarle literalmente dos días
Them: Yep.
Me: lo hice en seis horas, que me quedé ayer en el con
Them: Why no?
Me: me puse ido a fondo y escalo, o sea,
Them: Bueno, pero que lo pero que lo haga él. O sea, son horas, boludo.
Me: La parte de Eddie, sí, o sea, yo la parte del servidor y costo no sé si lo lo daría con Rodo. Realmente.
Them: Ok, ok.
Me: Pero la parte de de que funcione más fluido, Y lo otro lo voy ir on demand. Sí.
Them: Bien. Bueno, entonces, yo voy a eso, voy a bajar como, no sé, en una una planilla, no importa, donde sea, un spreadsheet, tipo, cada uno de los agents y cosas, creo que deberían tener, y vos empezás
Me: Okay.
Them: eso, a pensar cómo sería, tipo, el pipeline. Que creo
Me: Para, bueno mismo, lo del tema que estamos dando, o sea, toxic lo va a poner lo va publicar mañana.
Them: Topsy lo voy publicar mañana, yo creo que de acá a a como máximo... Digamos, lo que lo que planteamos es que el el el período de submissions termina la última semana de abril, Hasta hasta abril pueden hacer submission. Con lo cual hasta fin de abril pueden hacer submissions. Y la idea es que esto como que ya empezar a hacer un ongoing, Entonces, los proyectos van a empezar a mitad de mayo, de acá a dos semanas, deberíamos tener algo funcionando.
Me: Okay. Pensando, ¿sí? Agarra. Sí, hace bastante cositas, Pero, Puedo dedicarle
Them: Siento que estamos en un momento en donde en donde como que son, es raro, ¿viste?, como que siento que hay como spikes de trabajo muy intensos, y después, tipo, todo eso que pasó, hay que ir arreglándolo y puliéndolo. No, como que es distinto, antes siento que el trabajo era como más lineal,
Me: Sí,
Them: más progresivo, y ahora es tipo, y después,
Me: la cabeza te queda explotada de la cantidad de cosas que
Them: después el atma. Por eso, por eso. Pero por eso te digo, tipo, esto hiciste ahí, ¿cuándo te tardó? Y tardé cuatro horas en hacer esto. Sí, ok, bueno, ahora hay
Me: Por eso. Pulido.
Them: cuarenta horas de que es más baja. Y, si no, todo queda como a la mitad.
Me: No, no, eso estaba pensando, o sea, creo que lo que
Them: ¿No?
Me: va, no sé, pienso yo, ahora discutámoslo. Pero creo que capaz le puedo dedicar hoy y mañana a dejar esto, más o menos, estable para que Rob lo pueda iterar. De bueno, eso funcionó así, podemos dejar con Baby? Dejarlo en algo más o menos funcional, y ya el lunes le meto cien por ciento a a los agents.
Them: Okay.
Me: Que creo que los agents con Clautonio debería salir, o sea, bastante, o sea, hay que cambiar cosas, pero ya la parte difícil, digamos, de cómo conectar las cosas, ya está.
Them: Ok.
Me: Y nada, y también, de de hecho, no corto sé si arranco viernes y, de repente, arranco el lunes de vuelta como que tenés ese ahora que balconeás todo,
Them: Sí, sí, Ese.
Me: Antes no pasaba tanto porque estabas coleando dos, pero ahora que
Them: Sí, sí, obvio.
Me: es, promtear cosas. Y ya, yo creo que en una semana debería estar así, rápido, después de que
Them: Sí, algo para, algo algo que algo que que vaya a tener mucho input nuestro al principio.
Me: Sí, por eso.
Them: Yo, sinceramente, yo, sinceramente, creo que O sea, no no, sinceramente, no creo que recibamos un montón de preguntas. Esa es mi mi mayoría.
Me: ¿De cuándo son los grants?
Them: Pero, bueno, no sé, mojado, por ahí sí. ¿De cuánta plata? ¿De hasta quince mil?
Me: ¿Y por un laburo de cuántos meses?
Them: A tres meses tienen para hacer a él. Máximo,
Me: Aparece la plata, aparece la gente.
Them: Sí, sí, sí, va ver, es el gente, sí, sí, ya está pasando.
Me: Va a llevar un grant, seguramente.
Them: Sí, sí, o ya ahí, bueno, este, ahí le, tipo, Sí, sí, sí, obvio, que están en esa. Sí.
Me: Bien, dale, la zona que él lo lo encaro.
Them: Julio. Bien.
Me: Y hacemos un checkpoint no sé, jueves, de vuelta, si querés.
Them: Vale, sí.
Me: Como para Ajá.
Them: Bueno, tenemos a uno a uno el martes, pero el martes, ¿no? Miércoles.
Me: Un, como solo esto.
Them: Bien.
Me: Nada, igual, cuando lo cuando me sienta en cargarlo, te voy a a la pregunta, seguramente, y a
Them: Sí, sí, sí.
Me: Pero que pasen, dale. No deberías muy difícil.
Them: Buenísimo. Bueno, Listo.
Me: Vos mañana no estás, ¿no?
Them: O sea, voy a estar en el playtest seguro? Y si tenemos nuestro meeting o sea, voy a parar en la ruta, o sea, sea, viajo hoy a la noche, llego a la llego a las Cinco Y Media De La Mañana A Valencia, pero igual, nada, me encuentro con el chaval a las siete am. Me da el auto, o sea, hacer la movida del auto, El único miedo que tengo es que, bueno, nada, el el chaval es muy desconfiado, igual fue, pero es como muy desconfiado. Me dijo, tipo, si a mí no me llega plata a la cuenta de banco, tipo, no te vas con el auto. Yo le digo, bueno, no sé, o sea, ok, es una transferencia de casi veinte mil euros,
Me: ¿Cómo hacés?
Them: mil euros, le digo,
Me: Y no tardo.
Them: no, hay transferencias inmediatas, pero viste que a veces, no sé,
Me: Sí,
Them: a veces no sé, te la mandé, qué sé yo. Entonces, ya me veo, tipo, por ahí tres horas con el chavón, ¿entendés?, hasta que, no sé, incómodo, totalmente incómodo. Ojalá que no,
Me: ¿Dónde? Valencia, dijiste.
Them: Valencia, ¿sí?
Me: Después,
Them: Y y
Me: Listo.
Them: no, después me voy a, no, me voy el fin de semana de ese cumpleaños de un año de mi sobrina en Madrid, entonces
Me: Mhmm.
Them: me voy a, o sea, en Valencia me voy a Madrid, y y, bueno, nada, ya ahí son tres horas. Entonces, mi plan era llegar a Madrid a la a la hora del play, como Madrid al mediodía y ya.
Me: Sí.
Them: Si todo sale bien, eso va a pasar, si no, tendré que, nada, parar en la ruta tendré la
Me: A ver, la bueno, van, creo que con lo que tal, charlamos hoy, va, no sé si ha llamado más, pero la podemos recontaskipear.
Them: y
Me: Yo quería mostrarte nomás esto de OpenDiceps Studio, de
Them: Sí, no, no, no tengo nada en particular.
Me: lo que había hecho, y no mucho más.
Them: ¿Eso lo te hace legal o tenés algo para...?
Me: Vocal, no, fue todo ayer de siete fijás, los los los los comics. Esto ayer a las quince horas, doce horas, diez horas, nueve horas. Que fui compitiendo. Fue todo. Ok, se me se me fue como, che, pará, te hice esto y tengo esto ahora, como que si los juntas, lo que faltaba. No, y ahora hace mucho más, y hay que hazte interesa esa cosa que del syllabus, No, todo local. Bueno, todo lo debería subir. Pasa igual para subirlo a que te voy parar un servidor, hay que hay que poner un potente servidor para que maneje DM
Them: Sí, sí, claro. Che, boludo, está pasando algo con Claude, O sea, ¿te acordás? Acordás cuando hablamos hace un rato, que el chino contó eso? Que yo abrí mi
Me: Sí.
Them: mi Nada, recién, tipo, abrí ahí el el repo de hija que me pasaste, y estaba el estaba, este, abierto, y me dice que consumí cien por ciento de coso y tenía cinco por ciento hace una hora.
Me: ¿Cien por ciento? Se la van a
Them: Y y y no, o sea,
Me: la mandan a
Them: y no usé. Tipo, claramente, algo roto.
Me: La campeona. Campeona muchas veces, Claus, estaba caído demasiado.
Them: El señor actual, cien por ciento. Y no usé no lo usé, o sea, no no lo usé.
Me: Mirá, justo. Llegué al límite en medio de media hora. Sin un salo nada. El de cien dólares encima.
Them: ¿Quién dijo?
Me: No, de ahí puse Claudia en Twitter, Cloud pay plan limits are salary training in minutes. Están todos acá con la misma, Misma foto del cien por ciento usado.
Them: Sí, sí, me comió el, me la comió.
Me: No debe ser eso de que no me responde el
Them: Claro.
Me: el tuyo.
Them: Claro.
Me: No, no, no, la la la carne. Ahora igual llegan de por dos, seguro, ¿viste?, te tiran esa. La mandamos, tenés doble de Esa es la parte vuela.
Them: Qué gracioso, obvio.
Me: Bueno, nada, lo hacíamos el lunes.
Them: Bueno,
Me: ¿Algo más?
Them: Dale. No.
Me: De otra cosa?
Them: No.
Me: Bien. Ahí listo los chicos que, que para, no tenían el bill todavía, porque querían merallar un par de cosas. Al final del día, lo van a merallar. Lo probamos también en playtest, después nos quedamos de playtest. Todos los casos.
Them: Ok, sí, estaría bueno, eso estaría bueno el nada, que para mañana esté esté tipo publicado.
Me: No, eso, le dije, o sea, lo único, hoy, a a lo sumo hasta cuatro o cinco de la tarde, los bills. Como tíramelo los dos links
Them: Eso, Así no nos estábamos ahí con nada.
Me: Pero bueno, mañana lo testeamos en el playtest, y después nos quedamos testeando todo el flujo. Igual para, para ellos, el el Samillon de hoy no me preocupa tanto, me preocupa el Leandro. Mhmm. Sí.
Them: Sí, sí, porque eso tarda un rato, por eso eso tiene que ser hoy para que mañana esté. Después una cosa, vos tenés acceso, sí, tenés acceso al Play Store,
Me: Charlie, el pleito se lo pedí a Rodri, no sé si lo dio
Them: y tenés acceso a a todo el Play Store.
Me: a No estoy seguro de eso.
Them: E se no,
Me: Tiene igual, creo, me parece. Y, si no, le pido a... ¿Quién tienes? ¿Qué dice el el
Them: No, foundation, pero no, si no le digo a Rodríguez, mando un mail, tipo, le mando por WhatsApp. Porque ya me cuenta, no tengo acceso, quiero editar quiero editar cosas,
Me: 화? 화? 화? 화?
Them: ¿vos tampoco?
Me: No creo el de centran,
Them: Claro, yo no tengo nada.
Me: Si estás en el Google Play Store ponés sign out, se te te conecta del mismo Google Meet. Cofra que Se ve que se te desloguea de Google y te sacaba la corrección. Bien. Pero me me echó del meet y tuve que lodiar de vuelta.
Them: Bueno, yo no tengo acceso.
Me: Ahora, el Ruto, ¿mano qué más tiene? Claro.
Them: No, si no, es la típica cosa la que le voy a mandar un mensaje de rol y, tipo, che, boluda, sorry, que que te jodan con esto, pero nadie tiene acceso al préstamo.
Me: Sí. No, creo, vamos a pedir eso. Yo, la verdad, que me olvidé después de revalidarlo, pero
Them: Yo no, sí, no, no sabía. A ver, Con el central, no tengo, y con es tampoco tengo.
Me: Bueno, ahora le contá a Manu, y, si no, que nos dé acceso desde el celular a a, bueno, ahí nosotros.
Them: Ah, mirá, RP, App Store, Play Store, apps management, Okay. Bueno, no, si no, la otra vez pedirle a a Mariano. Mariano tiene el acceso a eso. Mariana
Me: Una mail.
Them: Sí. La misma María
Me: El hotel de la Mariano. Para romper las bolas con lo de Apple. Se había vencido el... Habría que cambiado los términos y conditions, y, si no, perceptabas no podías cosas. Apple. Apple sind apple.
Them: mandó con a vos.
Me: Marcamos la ida. ¿Cómo era? ¿Algo bueno que pasó con lo de los names? Estamos en la de mobile sync, fue como, che, te voy hacer lo de multiwords. Le digo, ¿se quedaste de Plogio a a Manú? Plogeo un multiword. No, no, quiero hacerlo yo así aprendo. Bueno, bien. Quiero tener, o sea, que quiero tener su propio board para saber todo el flujo. Más involucrados a los chicos.
Them: Ahí mail enviado a Mariana. Listo.
Me: Los dos.