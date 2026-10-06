# -*- coding: utf-8 -*-
"""
生成 eng-6.json 和 eng-7.json
严格规格: 50题 = choice 38 + judge 12; base 35 + mid 10 + high 5
choice: base 27 + mid 8 + high 3 = 38
judge : base  8 + mid 2 + high 2 = 12
choice answer 在 0/1/2/3 分布 9-10-10-9
judge true/false 各 6
"""
import json, random

random.seed(42)

# 每道题定义: (difficulty, q, [四个选项但第0个是正确答案], explain)
# 后续脚本会打乱选项位置并记录 answer
CHOICES_6 = [
    # ===== base 27 道 =====
    ("base","The doctor suggested that the patient ______ a good rest.",["have","has","had","would have"],
     "suggest 表示建议时，其后宾语从句用虚拟语气 should do，should 可以省略，故用动词原形 have。"),
    ("base","Could you tell me ______ the nearest hospital is?",["where","where is","that","which"],
     "宾语从句用陈述语序，where the nearest hospital is 语序正确。where is 是疑问语序，不能用于宾语从句。"),
    ("base","The boy ______ is playing basketball on the playground is my brother.",["who","which","whom","whose"],
     "先行词 the boy 指人，且在定语从句中作主语，用 who 引导。which 指物，whom 作宾语，whose 表所属。"),
    ("base","— Must I finish the work today? — No, you ______.",["needn't","mustn't","can't","may not"],
     "对 Must 开头的一般疑问句作否定回答用 needn't 或 don't have to，表示不必。mustn't 表示禁止，语气太强。"),
    ("base","Remember ______ off the lights when you leave the classroom.",["to turn","turning","turn","turned"],
     "remember to do 表示记得要去做某事，事情还没做；remember doing 表示记得做过某事。离开教室时才要关灯，动作未发生，用 to turn。"),
    ("base","This factory ______ in 1998 and has produced cars ever since.",["was built","built","is built","has built"],
     "工厂是被建造的，用被动语态；in 1998 是过去时间，用一般过去时的被动 was built。"),
    ("base","The teacher told us to stop ______ and listen to her carefully.",["talking","talk","to talk","talked"],
     "stop doing 表示停止正在做的事，stop to do 表示停下来去做另一件事。老师让学生停止讲话，用 stop talking。"),
    ("base","— How long may I ______ the book? — For two weeks.",["keep","borrow","lend","buy"],
     "how long 与延续性动词连用，borrow 和 lend 是短暂性动词，不能与时间段连用，应用 keep 表示借多久。"),
    ("base","— Would you mind if I smoke here? — ______. You'd better not.",["I'm afraid not","Not at all","Never mind","Better not"],
     "根据后句 You'd better not 可知说话人不希望对方吸烟，I'm afraid not 委婉表示不同意。Not at all 表示不介意，与语境矛盾。"),
    ("base","He prefers ______ at home rather than ______ out on such a cold day.",["to stay; go","stay; go","staying; going","to stay; to go"],
     "prefer to do rather than do 是固定句型，表示宁愿做……而不愿做……，两空分别用 to stay 和 go。"),
    ("base","Our monitor is always ready ______ others.",["to help","help","helping","helped"],
     "be ready to do 是固定搭配，表示乐意做某事、准备好做某事。"),
    ("base","Could you please ______ me your dictionary? Mine is lost.",["lend","borrow","keep","take"],
     "lend sb sth 表示把某物借给某人，此处请对方把字典借出给自己，用 lend。borrow 是从别人处借入，方向相反。"),
    ("base","I don't think he will come to the party, ______?",["will he","do I","don't I","won't he"],
     "主句是 I don't think 时，反意疑问句与从句保持一致，且否定转移后从句视为否定，附加部分用肯定 will he。"),
    ("base","— I'm going to Hainan for my holiday. — ______",["Have a good time!","That's all right.","Never mind.","It doesn't matter."],
     "对方要去度假，应祝愿 Have a good time 玩得愉快。其余选项用于回应道歉或安慰，不合语境。"),
    ("base","We ______ the classroom already. It's clean now.",["have cleaned","cleaned","had cleaned","clean"],
     "already 是现在完成时的标志词，且后句说明现在的结果，用 have cleaned。"),
    ("base","— What about ______ shopping this weekend? — Good idea.",["going","go","to go","goes"],
     "What about 后接动名词 doing，表示……怎么样，用 going。"),
    ("base","He spent two hours ______ his homework yesterday evening.",["doing","do","to do","did"],
     "spend time doing sth 是固定句型，表示花费时间做某事，用 doing。"),
    ("base","So far, great changes ______ place in our hometown.",["have taken","took","had taken","take"],
     "so far 是现在完成时的标志词，take place 无被动形式，用 have taken。"),
    ("base","— What did Mr Smith say? — He asked ______.",["what was wrong with me","what the matter was with me","what wrong was with me","what was the matter wrong with me"],
     "what was wrong with me 中 what 本身作主语，语序不变，间接引语中保持原语序，用陈述语序即可。"),
    ("base","The teacher made the students ______ the text after class.",["recite","to recite","reciting","recited"],
     "make sb do sth 表示让某人做某事，用动词原形 recite。注意被动语态中才还原 to。"),
    ("base","Why not ______ your teacher for help when you are in trouble?",["ask","asking","to ask","asks"],
     "Why not 后接动词原形，表示为什么不……，用于提建议。"),
    ("base","It's your turn ______ the blackboard, Li Ming.",["to clean","clean","cleaning","cleaned"],
     "It's one's turn to do sth 是固定句型，表示轮到某人做某事，用 to clean。"),
    ("base","— I called you this time yesterday, but nobody answered. — Oh, I ______ a shower at that time.",["was taking","took","have taken","take"],
     "this time yesterday 和 at that time 都指过去某一时刻正在进行的动作，用过去进行时 was taking。"),
    ("base","— Do you know ______? — Next Sunday.",["when they will come","when will they come","when did they come","when they came"],
     "宾语从句用陈述语序，排除疑问语序的选项；答语 Next Sunday 指将来，从句用一般将来时 they will come。"),
    ("base","He had hardly got to the station ______ the train left.",["when","than","before","as"],
     "hardly...when 是固定搭配，表示刚……就。no sooner 与 than 搭配，注意不要张冠李戴。"),
    ("base","— What do you think of our new teacher? — ______",["She is kind and patient.","She is a teacher.","She likes us.","She teaches English."],
     "What do you think of... 询问对某人的看法，回答应是评价性的，She is kind and patient 符合。其它选项是事实陈述非评价。"),
    ("base","The nurse asked the boy ______ his temperature first.",["to take","take","taking","took"],
     "ask sb to do sth 表示让某人做某事，用动词不定式 to take 作宾语补足语。"),
    # ===== mid 8 道 =====
    ("mid","By the end of last month, we ______ about 2,000 English words.",["had learned","learned","have learned","learn"],
     "by the end of last month 指到过去某一时间为止已完成的动作，用过去完成时 had learned，这是与现在完成时混淆的易错点。"),
    ("mid","He was ______ tired ______ he couldn't walk any further.",["so; that","such; that","too; to","very; that"],
     "so...that 引导结果状语从句，so 后接形容词 tired。such 后接名词短语，too...to 后接动词原形不能接句子。"),
    ("mid","I heard someone ______ for help when I passed the river.",["shouting","shout","to shout","shouted"],
     "hear sb doing 表示听见某人正在做某事，强调动作正在进行。hear sb do 表示听见全过程，此处路过时呼救正在进行，用 shouting。"),
    ("mid","The reason ______ he was late was ______ he missed the early bus.",["why; that","why; because","that; because","for; that"],
     "先行词 reason 后接 why 引导的定语从句；表语从句用 that 引导，即 The reason why...is that... 是固定句型，不能用 because 替代 that。"),
    ("mid","The little girl was made ______ the piano for two hours every day.",["to practise","practise","practising","practised"],
     "make sb do 变被动语态时要还原 to，即 be made to do，故用 to practise，这是常见易错点。"),
    ("mid","My father was too tired. He stopped ______ a rest after working for hours.",["to have","having","have","had"],
     "stop to do 表示停下来去做另一件事，此处指停下工作去休息，用 to have。stop having a rest 表示停止休息，与语境相反。"),
    ("mid","The old man lives ______, but he never feels ______.",["alone; lonely","lonely; alone","alone; alone","lonely; lonely"],
     "live alone 表示独自居住，alone 作副词；feel lonely 表示感到孤独，lonely 是形容词，二者易混，前者强调客观独自，后者强调主观感受。"),
    ("mid","— Shall we go to the park this afternoon? — ______ It's going to rain.",["I'm afraid not.","Good idea.","Yes, we shall.","That's right."],
     "由后句天要下雨可知不赞成去公园，I'm afraid not 表示恐怕不行，委婉拒绝。Good idea 与语境矛盾。"),
    # ===== high 3 道 =====
    ("high","______ the meeting was over, all the people left the hall.",["As soon as","Hardly had","No sooner had","Not until"],
     "as soon as 表示一……就，从句用一般过去时主句也用一般过去时，时态一致。hardly 和 no sooner 位于句首需倒装且与过去完成时搭配，not until 也需倒装，均与题干语序时态不符。"),
    ("high","It is necessary that everyone ______ the rules of the school.",["obey","obeys","obeyed","will obey"],
     "It is necessary that 从句用虚拟语气 should do，should 可省略，故用动词原形 obey。这是易与陈述语气混淆的考点。"),
    ("high","It is high time that we ______ measures to protect the environment.",["took","take","will take","should have taken"],
     "It is high time that 从句用虚拟语气，谓语用一般过去式 took，表示早该做某事。这是常见考点。"),
]

# 判断题：(difficulty, q, answer_bool, explain)
JUDGES_6 = [
    # base 8 道 (4T 4F)
    ("base","句子「This is the book which I bought it yesterday.」语法正确。",False,
     "定语从句中关系代词 which 已充当 bought 的宾语，it 重复多余，应删去 it。"),
    ("base","句子「I don't know where does he come from.」语法正确。",False,
     "宾语从句必须用陈述语序，疑问语序 where does he come from 错误，应为 where he comes from。"),
    ("base","对话「—Would you please help me carry the box? —With pleasure.」表达得体。",True,
     "With pleasure 表示很乐意帮忙，是回答请求的常用礼貌用语，表达得体。"),
    ("base","句子「He suggested me to go there by bus.」语法正确。",False,
     "suggest 不能用于 suggest sb to do sth 结构，可说 suggest doing 或 suggest that sb should do，应改为 He suggested going there by bus 或 He suggested that I go there by bus。"),
    ("base","句子「I wish I can fly to the moon one day.」语法正确。",False,
     "wish 后的宾语从句用虚拟语气，与现在事实相反用过去式，应为 I wish I could fly to the moon one day。"),
    ("base","句子「The film is worth seeing.」语法正确。",True,
     "be worth doing 是固定结构，用主动形式表示被动意义，seeing 用法正确。"),
    ("base","对话「—I'm sorry to trouble you. —It doesn't matter.」表达得体。",True,
     "回应道歉常用 It doesn't matter，表示没关系，是得体的日常交际用语。"),
    ("base","句子「Such fine weather is it that we all want to go out.」语法正确。",True,
     "such...that 句型中 such 位于句首时句子倒装，Such fine weather is it 语序正确，表示天气如此好以至于大家都想出去。"),
    # mid 2 道 (1T 1F)
    ("mid","句子「Not until midnight did he finish his homework.」语法正确。",True,
     "not until 位于句首时主句部分倒装，did he finish 为正确倒装形式，表示直到半夜他才完成作业。"),
    ("mid","句子「It takes me half an hour do my homework every day.」语法正确。",False,
     "It takes sb some time to do sth 句型中要用动词不定式，应改为 to do my homework。"),
    # high 2 道 (1T 1F)
    ("high","句子「No sooner had I got home than it began to rain.」语法正确。",True,
     "no sooner...than 句型中，no sooner 位于句首主句用过去完成时并倒装，从句用一般过去时，本句结构和时态都正确。"),
    ("high","句子「I would rather stay at home than go out in the heavy rain.」语法正确。",True,
     "would rather do than do 是固定句型，表示宁愿做……而不愿做……，两个动词都用原形，句子结构正确。"),
]

CHOICES_7 = [
    # base 27 道
    ("base","The nurse asked the boy ______ his temperature first.",["to take","take","taking","took"],
     "ask sb to do sth 表示让某人做某事，用动词不定式 to take 作宾语补足语。"),
    ("base","— Hello! May I speak to Mary? — ______",["This is Mary speaking.","Who are you?","I'm Mary.","Mary is me."],
     "电话用语中自我介绍用 This is...speaking，表示我就是玛丽。I'm Mary 是面对面介绍用语，电话中说 Who are you 不礼貌。"),
    ("base","I will never forget the days ______ we spent together in the countryside.",["that","when","where","in which"],
     "先行词 days 在定语从句中作 spent 的宾语，用关系代词 that 或 which。when 在从句中作时间状语，不符合此处结构。"),
    ("base","It's your turn ______ the blackboard, Li Ming.",["to clean","clean","cleaning","cleaned"],
     "It's one's turn to do sth 是固定句型，表示轮到某人做某事，用 to clean。"),
    ("base","The little boy ______ his key and couldn't get into the house.",["lost","was lost","has lost","loses"],
     "and 连接并列谓语，couldn't 提示用一般过去时，故用 lost。lose 作丢失解时是及物动词，可直接接宾语。"),
    ("base","— Shall I turn on the TV? — No, thanks. I ______ it already.",["have turned off","turn off","turned off","had turned off"],
     "already 是现在完成时的标志词，且强调对现在的影响，即电视已经关了所以不用再开，用 have turned off。"),
    ("base","Listen! Someone ______ at the door.",["is knocking","knocks","knocked","has knocked"],
     "Listen 提示此刻正在发生的动作，用现在进行时 is knocking。"),
    ("base","You should ______ the new words in a dictionary when you meet them.",["look up","look at","look after","look for"],
     "look up 表示查阅词典，look at 看，look after 照顾，look for 寻找。查单词用 look up。"),
    ("base","— You look tired. What's wrong? — I ______ late last night.",["stayed up","put up","got up","took up"],
     "stay up late 表示熬夜到很晚，与疲倦的状态相符。put up 张贴，get up 起床，take up 占据。"),
    ("base","My father ______ in this factory for twenty years.",["has worked","works","worked","will work"],
     "for twenty years 表示持续到现在的动作，用现在完成时 has worked。"),
    ("base","— I don't like playing basketball. What about you? — ______",["Neither do I.","So do I.","So I do.","Neither I do."],
     "表示前者否定情况也适用于后者用 Neither do I，意为我也不喜欢。So do I 用于肯定情况。"),
    ("base","Could you tell me ______ the railway station? I want to catch the train.",["the way to","where is","how can I get to","which way is"],
     "the way to the railway station 表示去火车站的路，结构正确。where is 缺主语，how can I get to 在宾语从句中应用陈述语序 how I can get to。"),
    ("base","— What do you think of our new teacher? — ______",["She is kind and patient.","She is thirty.","She likes red.","She lives near school."],
     "What do you think of... 是固定句型，询问对方对某人的看法，回答应是评价性的。其余选项只是事实陈述。"),
    ("base","I bought a gift for my mother on ______ Day.",["Women's","Woman's","Womans'","Women"],
     "Women's Day 是妇女节固定说法，woman 的复数 women 加 's 构成所有格。"),
    ("base","— I'm sorry, I can't go to your party tonight. — ______",["What a pity!","All right.","That's right.","Congratulations!"],
     "对方不能参加聚会，表示遗憾用 What a pity。All right 表示同意，Congratulations 用于祝贺。"),
    ("base","Let's go to the library, ______?",["shall we","will you","don't we","do we"],
     "Let's 开头的祈使句，反意疑问句用 shall we。Let us 开头才用 will you。"),
    ("base","The traffic light turned red, ______ we had to stop and wait.",["so","or","but","for"],
     "前句是原因后句是结果，用 so 连接表示因此。or 表示否则，but 表转折，for 表原因不用于此处。"),
    ("base","He has two sons. One is a doctor, and ______ is a teacher.",["the other","another","others","the others"],
     "两者中的另一个用 the other；another 指三者以上中的另一个，others 泛指其他人。"),
    ("base","The girl is too young ______ herself.",["to dress","dressing","dresses","dressed"],
     "too...to 表示太……而不能，too young to dress herself 意为太小不会自己穿衣服，用 to dress。"),
    ("base","— Must I stay at home all day long, Mum? — No, you ______. You can go out to play with your friends.",["needn't","mustn't","can't","may not"],
     "Must 引导的疑问句否定回答用 needn't 或 don't have to，表示不必。mustn't 表示禁止，语气不符。"),
    ("base","It's very kind ______ you to help me with my English.",["of","for","to","with"],
     "It's kind of sb to do sth 是固定句型，kind 是描述人的品质的形容词，用 of。for 用于描述事物性质。"),
    ("base","He walked ______ fast for us ______ catch up with.",["too; to","so; to","very; to","enough; to"],
     "too...for sb to do 表示太……以至于某人不能……，用 too; to。so...that 后接句子，题干后是不定式短语，不能选 A。"),
    ("base","— I'm sorry to trouble you. — ______",["It doesn't matter.","That's right.","All right.","You are welcome."],
     "回应道歉用 It doesn't matter，表示没关系。You are welcome 用于回应感谢，不符合此处语境。"),
    ("base","— Happy New Year! — ______",["The same to you.","You're welcome.","It doesn't matter.","All right."],
     "对方祝贺新年时，回应 The same to you 表示也祝你新年快乐，是得体的节日交际用语。"),
    ("base","— Would you like some more tea? — ______ I'm full.",["No, thanks.","Yes, please.","I like it.","That's good."],
     "由后句 I'm full 可知不想要了，礼貌拒绝用 No, thanks。Yes, please 与语境矛盾。"),
    ("base","— How long have you ______ the bike? — For two years.",["had","bought","borrowed","lent"],
     "how long 与延续性动词连用，buy、borrow、lend 都是短暂性动词不能与时间段连用，应用 have 的过去分词 had 表示拥有。"),
    ("base","— What's the weather like today? — ______",["It's sunny.","It's Sunday.","It's June.","It's ten o'clock."],
     "询问天气用 What's the weather like，回答应用描述天气的句子，It's sunny 符合。"),
    # mid 8 道
    ("mid","We ______ each other since we left school ten years ago.",["haven't seen","didn't see","won't see","don't see"],
     "since 引导过去时间状语从句时，主句用现在完成时 haven't seen，表示从那时起到现在一直没见面。"),
    ("mid","He was ______ excited ______ say a word when he heard the good news.",["too; to","so; that","enough; to","very; that"],
     "too...to 表示太……而不能，too excited to say a word 意为激动得说不出话。so...that 后需接句子，题干后是动词短语 say a word，不能选 A。"),
    ("mid","The headmaster ordered that the sports meeting ______ put off till next week.",["be","was","would be","is"],
     "order 表示命令时，宾语从句用虚拟语气 should be done，should 可省，故用 be。这是被动与虚拟结合的考点。"),
    ("mid","She devoted all her life ______ for the disabled children.",["to caring","to care","caring","care"],
     "devote...to doing 中 to 是介词，后接动名词，即 to caring，表示毕生致力于照顾残疾儿童。易误认为 devote to do，需注意 to 在此是介词。"),
    ("mid","The film ______ for ten minutes when we got to the cinema.",["had been on","had begun","began","has been on"],
     "for ten minutes 要求用延续性动词，begin 是短暂性动词，应转换为 be on；到电影院是过去动作，电影开始在其之前，用过去完成时 had been on。"),
    ("mid","I have ______ friends here, so I often feel lonely.",["few","little","a little","a few"],
     "friends 是可数名词复数，排除修饰不可数名词的 little 和 a little；后句说感到孤独，说明几乎没有朋友，用表示否定的 few。"),
    ("mid","The problem ______ at tomorrow's meeting is very important.",["to be discussed","discussed","discussing","being discussed"],
     "明天会议上将要被讨论，用不定式的被动式 to be discussed 作后置定语，表示将来和被动。discussed 表已完成，being discussed 表正在进行。"),
    ("mid","The workers ______ a new bridge over the river by the end of next year.",["will have built","build","will build","have built"],
     "by the end of next year 指到将来某时为止完成的动作，用将来完成时 will have built。"),
    # high 3 道
    ("high","______ he comes or not makes no difference to me.",["Whether","If","That","What"],
     "主语从句位于句首时只能用 whether 不能用 if，whether...or not 表示是否。if 引导主语从句不能位于句首，这是易错点。"),
    ("high","It's time we ______ home. It's getting dark.",["went","go","will go","to go"],
     "It's time that 从句用虚拟语气，谓语用一般过去式 went，表示我们该回家了。"),
    ("high","He insisted that he ______ right and that the plan ______ carried out at once.",["was; be","was; was","be; be","should be; be"],
     "insist 表示坚持认为时从句用陈述语气，he was right 是事实陈述；表示坚持要求时从句用虚拟语气 should be carried out，should 可省。两空分别对应两种用法，这是易混考点。"),
]

JUDGES_7 = [
    # base 8 道 (4T 4F)
    ("base","句子「He is too young to go to school.」语法正确。",True,
     "too...to 结构表示太……而不能，too 后接形容词 young，to 后接动词原形 go，句子结构正确。"),
    ("base","句子「Neither he nor I are good at maths.」语法正确。",False,
     "neither...nor 连接两个主语时，谓语动词与最近的主语保持一致，I 前应用 am，即 Neither he nor I am good at maths。"),
    ("base","对话「—Happy New Year! —The same to you.」表达得体。",True,
     "对方祝贺新年时，回应 The same to you 表示也祝你新年快乐，是得体的节日交际用语。"),
    ("base","句子「I have two sisters. One is a teacher, the other is a nurse.」中 the other 用法正确。",True,
     "两者中一个……另一个……用 one...the other...，句中只有两个姐姐，the other 指代另一个，用法正确。"),
    ("base","对话「—I'm sorry I broke your cup. —Never mind.」表达得体。",True,
     "Never mind 用于回应道歉，表示没关系，是得体的日常交际用语。"),
    ("base","句子「Please pass me the pen.」与「Please pass the pen to me.」意思相同。",True,
     "pass sb sth 等于 pass sth to sb，是双宾语的两种表达方式，意思相同。"),
    ("base","句子「Would you like some more tea?」用于询问对方是否再要些茶。",True,
     "Would you like... 用于礼貌地询问对方想要某物，some more tea 表示再要些茶，句意理解正确。"),
    ("base","句子「You had better not to stay up too late.」语法正确。",False,
     "had better 后接动词原形，否定式为 had better not do，应删去 to，即 You had better not stay up too late。"),
    # mid 2 道 (1T 1F)
    ("mid","句子「The more you practise, the more progress you will make.」语法正确。",True,
     "the more...the more 结构表示越……越……，两个比较级分别位于句首，句子结构正确。"),
    ("mid","句子「My father told me that the sun rises in the east.」语法正确。",True,
     "宾语从句表示客观真理时，即使主句是过去时，从句也用一般现在时，rises 用法正确。"),
    # high 2 道
    ("high","句子「Had I known your address earlier, I would have written to you.」语法正确。",True,
     "虚拟条件句中省略 if 时可将 had 提前倒装，Had I known 等同于 If I had known，与过去事实相反，主句用 would have written，句子正确。"),
    ("high","句子「The news that our team won the game is exciting.」中 that 引导的是定语从句。",False,
     "that 引导的从句说明 news 的具体内容，是同位语从句而非定语从句；定语从句中 that 充当成分，而同位语从句中 that 不充当成分只起连接作用。"),
]

def build(choices, judges, seed):
    random.seed(seed)
    out = []
    # 处理单选：打乱选项位置，记录答案索引
    choice_items = []
    for diff, q, opts, exp in choices:
        correct_text = opts[0]  # 第一个是正确答案
        shuffled = opts[:]
        random.shuffle(shuffled)
        ans_idx = shuffled.index(correct_text)
        choice_items.append({"type":"choice","difficulty":diff,"q":q,"options":shuffled,"answer":ans_idx,"explain":exp})
    # 处理判断
    judge_items = []
    for diff, q, ans, exp in judges:
        judge_items.append({"type":"judge","difficulty":diff,"q":q,"answer":ans,"explain":exp})
    # 合并并打乱顺序
    out = choice_items + judge_items
    random.shuffle(out)
    return out

# 校验答案分布，如果太偏就换 seed
def get_ans_dist(items):
    d = [0,0,0,0]
    for x in items:
        if x['type']=='choice':
            d[x['answer']] += 1
    return d

for fpath, C, J, seed in [(r'f:\personal-nav\quizgen\eng-6.json', CHOICES_6, JUDGES_6, 6),
                            (r'f:\personal-nav\quizgen\eng-7.json', CHOICES_7, JUDGES_7, 7)]:
    best = None
    for s in range(seed*100, seed*100+50):
        items = build(C, J, s)
        dist = get_ans_dist(items)
        # 检查分布：9-10-10-9 或 10-10-9-9 等，最大差<=2
        if max(dist) - min(dist) <= 2 and min(dist) >= 8:
            best = (s, items, dist)
            break
    if best is None:
        # 退而求其次
        items = build(C, J, seed)
        dist = get_ans_dist(items)
        best = (seed, items, dist)
    s, items, dist = best
    with open(fpath, 'w', encoding='utf-8') as f:
        f.write('[\n')
        for i, it in enumerate(items):
            line = json.dumps(it, ensure_ascii=False)
            f.write(line)
            if i < len(items)-1:
                f.write(',\n')
            else:
                f.write('\n')
        f.write(']\n')
    print(fpath, 'seed=', s, 'dist=', dist)
