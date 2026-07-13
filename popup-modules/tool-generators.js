(function () {
  'use strict';

  const NAME_DATA = {
    en: {
      male: ['James', 'John', 'Robert', 'Michael', 'David', 'William', 'Richard', 'Joseph', 'Thomas', 'Charles', 'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Steven', 'Andrew', 'Paul', 'Joshua', 'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Raymond', 'Gregory', 'Frank', 'Alexander', 'Patrick', 'Jack', 'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Nathan', 'Henry', 'Peter', 'Adam', 'Douglas', 'Zachary', 'Logan', 'Ethan', 'Noah', 'Mason', 'Lucas', 'Oliver', 'Elijah', 'Liam', 'Aiden', 'Carter', 'Luke', 'Owen', 'Dylan', 'Hunter', 'Gabriel', 'Caleb', 'Connor'],
      female: ['Mary', 'Patricia', 'Jennifer', 'Linda', 'Barbara', 'Elizabeth', 'Susan', 'Jessica', 'Sarah', 'Karen', 'Lisa', 'Nancy', 'Betty', 'Margaret', 'Sandra', 'Ashley', 'Dorothy', 'Kimberly', 'Emily', 'Donna', 'Michelle', 'Carol', 'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia', 'Kathleen', 'Amy', 'Angela', 'Shirley', 'Anna', 'Brenda', 'Pamela', 'Emma', 'Nicole', 'Helen', 'Samantha', 'Katherine', 'Christine', 'Debra', 'Rachel', 'Carolyn', 'Janet', 'Catherine', 'Maria', 'Heather', 'Diane', 'Ruth', 'Julie', 'Olivia', 'Joyce', 'Virginia', 'Victoria', 'Kelly', 'Lauren', 'Christina', 'Joan', 'Evelyn', 'Judith', 'Megan', 'Andrea', 'Cheryl', 'Hannah', 'Jacqueline', 'Martha', 'Gloria', 'Teresa', 'Ann', 'Sara', 'Madison', 'Frances', 'Kathryn', 'Janice', 'Jean', 'Abigail', 'Alice', 'Judy', 'Sophia', 'Grace', 'Denise', 'Amber', 'Doris', 'Marilyn', 'Danielle', 'Beverly', 'Isabella', 'Theresa', 'Diana', 'Natalie', 'Brittany', 'Charlotte', 'Marie', 'Kayla', 'Alexis', 'Lori'],
      last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Evans', 'Turner', 'Phillips', 'Parker', 'Edwards', 'Collins', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan', 'Peterson', 'Cooper', 'Reed', 'Bailey', 'Bell', 'Gomez', 'Kelly', 'Howard', 'Ward', 'Cox', 'Diaz', 'Richardson', 'Wood', 'Watson', 'Brooks', 'Bennett', 'Gray', 'James', 'Reyes', 'Cruz', 'Hughes', 'Price', 'Myers', 'Long', 'Foster', 'Sanders', 'Ross', 'Morales', 'Powell', 'Sullivan', 'Russell', 'Ortiz', 'Jenkins']
    },
    zh: {
      surname: ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧', '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕', '苏', '卢', '蒋', '蔡', '贾', '丁', '魏', '薛', '叶', '阎', '余', '潘', '杜', '戴', '夏', '钟', '汪', '田', '任', '姜', '范', '方', '石', '姚', '谭', '廖', '邹', '熊', '金', '陆', '郝', '孔', '白', '崔', '康', '毛', '邱', '秦', '江', '史', '顾', '侯', '邵', '孟', '龙', '万', '段', '章', '钱', '汤', '尹', '黎', '易', '常', '武', '乔', '贺', '赖', '龚', '文'],
      male: ['伟', '强', '磊', '洋', '勇', '军', '杰', '涛', '超', '明', '刚', '平', '辉', '鑫', '鹏', '飞', '波', '斌', '宇', '浩', '然', '俊', '哲', '睿', '博', '昊', '翔', '旭', '栋', '晖', '健', '凯', '锐', '彬', '毅', '轩', '恒', '骏', '松', '宁', '铭', '瑞', '驰', '瀚', '翰', '霖', '华', '文', '志', '熙', '泽', '航', '皓', '嘉', '禹', '煜', '逸', '清', '楠', '峰'],
      female: ['芳', '娜', '敏', '静', '丽', '莉', '秀', '玲', '桂', '燕', '萍', '华', '红', '玉', '慧', '琳', '雪', '婷', '珍', '颖', '欣', '怡', '蕾', '雯', '洁', '瑶', '璐', '薇', '妍', '馨', '彤', '晗', '梦', '琪', '岚', '蓓', '苑', '茜', '蕊', '妮', '菲', '晴', '诗', '涵', '媛', '悦', '佳', '瑾', '若', '萱', '彦', '姝', '韵', '寒', '曦', '依', '舒', '宜', '凝', '柔']
    }
  };

  const ADDRESS_DATA = {
    zh: {
      provinces: [
        { name: '北京市', cities: ['东城区', '西城区', '朝阳区', '丰台区', '石景山区', '海淀区', '顺义区', '通州区', '大兴区', '昌平区'] },
        { name: '上海市', cities: ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '浦东新区', '闵行区', '宝山区'] },
        { name: '广东省', cities: ['广州市', '深圳市', '珠海市', '东莞市', '佛山市', '中山市', '惠州市', '汕头市', '江门市', '湛江市'] },
        { name: '浙江省', cities: ['杭州市', '宁波市', '温州市', '嘉兴市', '湖州市', '绍兴市', '金华市', '台州市'] },
        { name: '江苏省', cities: ['南京市', '苏州市', '无锡市', '常州市', '南通市', '扬州市', '镇江市', '徐州市'] },
        { name: '四川省', cities: ['成都市', '绵阳市', '德阳市', '宜宾市', '南充市', '泸州市', '乐山市'] },
        { name: '湖北省', cities: ['武汉市', '宜昌市', '襄阳市', '荆州市', '黄冈市', '十堰市'] },
        { name: '湖南省', cities: ['长沙市', '株洲市', '湘潭市', '衡阳市', '岳阳市', '常德市'] },
        { name: '山东省', cities: ['济南市', '青岛市', '烟台市', '潍坊市', '临沂市', '淄博市'] },
        { name: '福建省', cities: ['福州市', '厦门市', '泉州市', '漳州市', '龙岩市', '莆田市'] },
        { name: '河南省', cities: ['郑州市', '洛阳市', '开封市', '南阳市', '新乡市', '安阳市'] },
        { name: '安徽省', cities: ['合肥市', '芜湖市', '安庆市', '马鞍山市', '蚌埠市'] },
        { name: '河北省', cities: ['石家庄市', '唐山市', '保定市', '邯郸市', '廊坊市'] },
        { name: '辽宁省', cities: ['沈阳市', '大连市', '鞍山市', '抚顺市', '锦州市'] },
        { name: '陕西省', cities: ['西安市', '咸阳市', '宝鸡市', '渭南市', '延安市'] },
        { name: '重庆市', cities: ['渝中区', '江北区', '沙坪坝区', '九龙坡区', '南岸区', '渝北区', '巴南区'] },
        { name: '天津市', cities: ['和平区', '河西区', '南开区', '河东区', '河北区', '滨海新区'] },
        { name: '云南省', cities: ['昆明市', '大理市', '丽江市', '曲靖市'] },
        { name: '贵州省', cities: ['贵阳市', '遵义市', '六盘水市'] },
        { name: '广西', cities: ['南宁市', '桂林市', '柳州市', '北海市'] }
      ],
      roads: ['中山路', '解放路', '人民路', '建设路', '文化路', '和平路', '新华路', '长安街', '南京路', '北京路',
        '朝阳路', '花园路', '科技路', '创业路', '滨海路', '学府路', '迎宾路', '幸福路', '光明路', '长江路',
        '黄河路', '泰山路', '华山路', '庐山路', '天山路', '昆仑路', '长江街', '复兴路', '建国路', '锦绣路'],
      suffixes: ['小区', '花园', '公寓', '新村', '大厦', '广场', '中心'],
      buildingPrefixes: ['A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '5', '6', '7', '8']
    },
    en: {
      states: [
        { name: 'CA', cities: ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Fresno', 'Oakland', 'Palo Alto'] },
        { name: 'NY', cities: ['New York', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'Yonkers'] },
        { name: 'TX', cities: ['Houston', 'Austin', 'Dallas', 'San Antonio', 'Fort Worth', 'Plano', 'Irving'] },
        { name: 'FL', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'Tallahassee'] },
        { name: 'IL', cities: ['Chicago', 'Springfield', 'Naperville', 'Peoria', 'Rockford'] },
        { name: 'WA', cities: ['Seattle', 'Bellevue', 'Redmond', 'Tacoma', 'Spokane', 'Vancouver'] },
        { name: 'MA', cities: ['Boston', 'Cambridge', 'Worcester', 'Springfield', 'Lowell'] },
        { name: 'CO', cities: ['Denver', 'Boulder', 'Colorado Springs', 'Aurora', 'Fort Collins'] },
        { name: 'OR', cities: ['Portland', 'Eugene', 'Salem', 'Bend', 'Hillsboro'] },
        { name: 'GA', cities: ['Atlanta', 'Savannah', 'Augusta', 'Athens', 'Macon'] }
      ],
      streets: ['Main', 'Oak', 'Maple', 'Elm', 'Cedar', 'Pine', 'Washington', 'Lake', 'Park', 'Hill',
        'River', 'Spring', 'Church', 'Mill', 'Center', 'Union', 'Broadway', 'Market', 'Walnut', 'Cherry',
        'Madison', 'Jefferson', 'Lincoln', 'Franklin', 'Highland', 'Sunset', 'Willow', 'Meadow', 'Valley', 'Forest'],
      streetTypes: ['St', 'Ave', 'Blvd', 'Dr', 'Ln', 'Rd', 'Ct', 'Way', 'Pl', 'Cir'],
      suffixes: ['Apt', 'Unit', 'Suite', '#']
    },
    uk: {
      counties: [
        { name: 'Greater London', cities: ['London', 'Croydon', 'Bromley', 'Kingston upon Thames', 'Harrow'] },
        { name: 'Greater Manchester', cities: ['Manchester', 'Salford', 'Stockport', 'Bolton', 'Oldham'] },
        { name: 'West Midlands', cities: ['Birmingham', 'Coventry', 'Wolverhampton', 'Solihull'] },
        { name: 'West Yorkshire', cities: ['Leeds', 'Bradford', 'Wakefield', 'Huddersfield'] },
        { name: 'Merseyside', cities: ['Liverpool', 'Birkenhead', 'St Helens', 'Southport'] },
        { name: 'Tyne and Wear', cities: ['Newcastle upon Tyne', 'Sunderland', 'Gateshead'] },
        { name: 'South Yorkshire', cities: ['Sheffield', 'Doncaster', 'Rotherham'] },
        { name: 'Hampshire', cities: ['Southampton', 'Portsmouth', 'Winchester', 'Basingstoke'] },
        { name: 'Lancashire', cities: ['Preston', 'Blackpool', 'Blackburn', 'Lancaster'] },
        { name: 'Essex', cities: ['Chelmsford', 'Colchester', 'Southend-on-Sea', 'Basildon'] }
      ],
      streets: ['High', 'Station', 'Church', 'Mill', 'Green', 'Park', 'School', 'Victoria', 'Queen', 'King',
        'New', 'West', 'North', 'South', 'East', 'Bridge', 'Market', 'Manor', 'Orchard', 'Grange',
        'Meadow', 'Springfield', 'Richmond', 'Windsor', 'Stanley', 'Albert', 'George', 'Oxford', 'Cambridge', 'Clarence'],
      streetTypes: ['Road', 'Street', 'Lane', 'Avenue', 'Close', 'Drive', 'Way', 'Gardens', 'Crescent', 'Mews'],
      suffixes: ['Flat', 'Apartment', 'Floor']
    },
    jp: {
      prefectures: [
        { name: '東京都', cities: ['新宿区', '渋谷区', '港区', '千代田区', '中央区', '文京区', '台東区', '品川区', '目黒区', '豊島区'] },
        { name: '大阪府', cities: ['大阪市北区', '大阪市中央区', '大阪市天王寺区', '堺市', '吹田市', '豊中市'] },
        { name: '神奈川県', cities: ['横浜市', '川崎市', '相模原市', '鎌倉市', '藤沢市'] },
        { name: '愛知県', cities: ['名古屋市', '豊田市', '岡崎市', '一宮市', '春日井市'] },
        { name: '京都府', cities: ['京都市中京区', '京都市東山区', '京都市左京区', '宇治市', '亀岡市'] },
        { name: '北海道', cities: ['札幌市', '函館市', '旭川市', '小樽市', '帯広市'] },
        { name: '福岡県', cities: ['福岡市博多区', '福岡市中央区', '北九州市', '久留米市'] },
        { name: '兵庫県', cities: ['神戸市', '姫路市', '西宮市', '尼崎市', '明石市'] },
        { name: '千葉県', cities: ['千葉市', '船橋市', '松戸市', '柏市', '市川市'] },
        { name: '埼玉県', cities: ['さいたま市', '川口市', '川越市', '所沢市', '越谷市'] }
      ],
      streets: ['桜', '富士見', '中央', '昭和', '平和', '緑', '朝日', '本町', '元町', '栄町',
        '幸町', '末広', '曙', '高砂', '錦', '春日', '銀座', '大手町', '丸の内', '霞が関',
        '青山', '麻布', '日本橋', '四谷', '三田', '九段', '早稲田', '神楽坂', '月島', '豊洲'],
      suffixes: ['マンション', 'アパート', 'ハイツ', 'コーポ']
    },
    kr: {
      provinces: [
        { name: '서울특별시', cities: ['강남구', '서초구', '종로구', '중구', '마포구', '용산구', '송파구', '영등포구', '동대문구', '성북구'] },
        { name: '경기도', cities: ['수원시', '성남시', '고양시', '용인시', '부천시', '안산시', '화성시'] },
        { name: '부산광역시', cities: ['해운대구', '부산진구', '동래구', '남구', '수영구'] },
        { name: '인천광역시', cities: ['연수구', '남동구', '부평구', '계양구', '중구'] },
        { name: '대구광역시', cities: ['수성구', '중구', '달서구', '동구', '북구'] },
        { name: '대전광역시', cities: ['유성구', '서구', '중구', '동구', '대덕구'] },
        { name: '광주광역시', cities: ['동구', '서구', '남구', '북구', '광산구'] }
      ],
      streets: ['중앙로', '문화로', '태평로', '번영로', '삼성로', '테헤란로', '을지로', '종로',
        '강남대로', '올림픽로', '청계천로', '남대문로', '세종대로', '월드컵로', '한강대로'],
      suffixes: ['아파트', '오피스텔', '빌라'],
      dongSuffixes: ['동', '읍', '면']
    }
  };

  /**
   * Generate a cryptographically random password that is guaranteed to include
   * at least one character from every selected character class.
   *
   * @param {number} len - password length (4–128)
   * @param {boolean} useUpper - include uppercase A-Z
   * @param {boolean} useLower - include lowercase a-z
   * @param {boolean} useDigit - include digits 0-9
   * @param {boolean} useSpecial - include special characters
   * @param {boolean} noAmbig - exclude ambiguous characters (O0lI1|)
   * @returns {string} generated password
   */
  function generatePassword(len, useUpper, useLower, useDigit, useSpecial, noAmbig) {
    const ambiguous = 'O0lI1|';
    const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
    const digitChars = '0123456789';
    const specialChars = '!@#$%^&*()-_=+[]{}:;<>,.?/~';

    // Build per-class character sets
    const sets = [];
    if (useUpper) sets.push(upperChars);
    if (useLower) sets.push(lowerChars);
    if (useDigit) sets.push(digitChars);
    if (useSpecial) sets.push(specialChars);

    // Fallback: if nothing selected, default to lowercase + digits
    if (sets.length === 0) {
      sets.push(lowerChars, digitChars);
    }

    // Apply ambiguous-character filter to each set individually
    if (noAmbig) {
      for (let i = 0; i < sets.length; i++) {
        sets[i] = sets[i].split('').filter(function (c) {
          return ambiguous.indexOf(c) === -1;
        }).join('');
      }
    }

    // Combined pool for filling remaining slots
    const allChars = sets.join('');

    // Step 1 — guarantee: pick one random char from every selected set
    const passwordArr = [];
    for (let i = 0; i < sets.length; i++) {
      var randArr = new Uint32Array(1);
      crypto.getRandomValues(randArr);
      passwordArr.push(sets[i][randArr[0] % sets[i].length]);
    }

    // Step 2 — fill the remaining slots from the combined pool
    var remaining = len - passwordArr.length;
    if (remaining > 0) {
      var fillRand = new Uint32Array(remaining);
      crypto.getRandomValues(fillRand);
      for (var ri = 0; ri < remaining; ri++) {
        passwordArr.push(allChars[fillRand[ri] % allChars.length]);
      }
    }

    // Step 3 — Fisher-Yates shuffle with crypto randomness
    for (var i = passwordArr.length - 1; i > 0; i--) {
      var swapRand = new Uint32Array(1);
      crypto.getRandomValues(swapRand);
      var j = swapRand[0] % (i + 1);
      var tmp = passwordArr[i];
      passwordArr[i] = passwordArr[j];
      passwordArr[j] = tmp;
    }

    return passwordArr.join('');
  }

  function pickRandom(list, random) {
    return list[Math.floor(random() * list.length)];
  }

  function randomInt(min, max, random) {
    return min + Math.floor(random() * (max - min + 1));
  }

  /**
   * 生成姓名数据。调用方通过参数明确普通工具与快填的分布差异。
   */
  function generateName({
    region = 'en',
    gender = 'random',
    zhTwoCharacterProbability = 0.6,
    fallbackGender = '',
    random = Math.random
  } = {}) {
    const resolvedGender = gender === 'random'
      ? (random() < 0.5 ? 'male' : 'female')
      : gender;

    if (region === 'en') {
      const firstName = pickRandom(NAME_DATA.en[resolvedGender] || NAME_DATA.en[fallbackGender], random);
      const lastName = pickRandom(NAME_DATA.en.last, random);
      return {
        fullName: `${firstName} ${lastName}`,
        firstName,
        lastName,
        gender: resolvedGender,
        region
      };
    }

    const lastName = pickRandom(NAME_DATA.zh.surname, random);
    const givenPool = NAME_DATA.zh[resolvedGender] || NAME_DATA.zh[fallbackGender];
    const givenLength = random() < zhTwoCharacterProbability ? 2 : 1;
    let firstName = '';
    for (let i = 0; i < givenLength; i += 1) {
      firstName += pickRandom(givenPool, random);
    }
    return {
      fullName: lastName + firstName,
      firstName,
      lastName,
      gender: resolvedGender,
      region
    };
  }

  /**
   * 在闭区间年份内生成生日；now 可注入，便于调用方稳定复用和测试。
   */
  function generateBirthday({
    minYear = 1980,
    maxYear = 2005,
    now = new Date(),
    random = Math.random
  } = {}) {
    let lowerYear = Number.parseInt(minYear, 10) || 1980;
    let upperYear = Number.parseInt(maxYear, 10) || 2005;
    if (lowerYear > upperYear) {
      [lowerYear, upperYear] = [upperYear, lowerYear];
    }

    const year = randomInt(lowerYear, upperYear, random);
    const month = randomInt(1, 12, random);
    const daysInMonth = new Date(year, month, 0).getDate();
    const day = randomInt(1, daysInMonth, random);
    let age = now.getFullYear() - year;
    const currentMonth = now.getMonth() + 1;
    if (currentMonth < month || (currentMonth === month && now.getDate() < day)) {
      age -= 1;
    }

    return {
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      age: Math.max(0, age),
      year,
      month,
      day
    };
  }

  /**
   * 生成地址。legacy-fast-fill 用于精确保留旧快填的简化地址分布。
   */
  function generateAddress({ region = 'zh', preset = 'full', random = Math.random } = {}) {
    if (preset === 'legacy-fast-fill') {
      const roads = ['中山路', '解放路', '人民路', '建设路', '文化路', '和平路'];
      const cities = ['北京市朝阳区', '上海市浦东新区', '广州市天河区', '深圳市南山区', '杭州市西湖区'];
      const road = pickRandom(roads, random);
      const roadNum = randomInt(1, 300, random);
      const city = pickRandom(cities, random);
      return `${city}${road}${roadNum}号`;
    }

    if (region === 'zh') {
      const data = ADDRESS_DATA.zh;
      const province = pickRandom(data.provinces, random);
      const city = pickRandom(province.cities, random);
      const road = pickRandom(data.roads, random);
      const roadNum = randomInt(1, 300, random);
      const suffix = pickRandom(data.suffixes, random);
      const buildingPrefix = pickRandom(data.buildingPrefixes, random);
      const buildingNum = randomInt(1, 30, random);
      const unitNum = randomInt(1, 5, random);
      const roomNum = randomInt(101, 2808, random);
      return `${province.name}${city}${road}${roadNum}号${suffix}${buildingPrefix}栋${buildingNum}单元${String(unitNum).padStart(2, '0')}${roomNum}室`;
    }
    if (region === 'en') {
      const data = ADDRESS_DATA.en;
      const state = pickRandom(data.states, random);
      const city = pickRandom(state.cities, random);
      const num = randomInt(100, 9999, random);
      const street = pickRandom(data.streets, random);
      const streetType = pickRandom(data.streetTypes, random);
      const suffix = pickRandom(data.suffixes, random);
      const aptNum = randomInt(1, 500, random);
      const zip5 = String(randomInt(10000, 99999, random));
      const zip4 = String(randomInt(1000, 9999, random));
      return `${num} ${street} ${streetType}, ${suffix} ${aptNum}, ${city}, ${state.name} ${zip5}-${zip4}`;
    }
    if (region === 'uk') {
      const data = ADDRESS_DATA.uk;
      const county = pickRandom(data.counties, random);
      const city = pickRandom(county.cities, random);
      const num = randomInt(1, 200, random);
      const street = pickRandom(data.streets, random);
      const streetType = pickRandom(data.streetTypes, random);
      const suffix = pickRandom(data.suffixes, random);
      const suffixNum = randomInt(1, 100, random);
      const postcodeArea = pickRandom(['SW', 'NW', 'SE', 'NE', 'EC', 'WC', 'E', 'W', 'N', 'S', 'B', 'M', 'L', 'G'], random);
      const postcodeNum = randomInt(1, 20, random);
      const postcodeSuffix = pickRandom(['AA', 'AB', 'AD', 'AE', 'AG', 'AH', 'AL', 'AN', 'AR', 'AT', 'BA', 'BB', 'BD', 'BE', 'BG', 'BH', 'BL', 'BN', 'BP', 'BQ', 'BR', 'BS', 'BT', 'BU', 'BW', 'BX', 'BY', 'BZ'], random);
      return `${num} ${street} ${streetType}, ${suffix} ${suffixNum}, ${city}, ${county.name}, ${postcodeArea}${postcodeNum} ${randomInt(1, 9, random)}${postcodeSuffix}`;
    }
    if (region === 'jp') {
      const data = ADDRESS_DATA.jp;
      const prefecture = pickRandom(data.prefectures, random);
      const city = pickRandom(prefecture.cities, random);
      const street = pickRandom(data.streets, random);
      const chome = randomInt(1, 7, random);
      const ban = randomInt(1, 30, random);
      const go = randomInt(1, 20, random);
      const suffix = pickRandom(data.suffixes, random);
      const roomNum = randomInt(101, 888, random);
      const postal3 = String(randomInt(100, 999, random));
      const postal4 = String(randomInt(1000, 9999, random));
      return `〒${postal3}-${postal4} ${prefecture.name}${city}${street}${chome}丁目${ban}番${go}号 ${suffix}${roomNum}号室`;
    }
    if (region === 'kr') {
      const data = ADDRESS_DATA.kr;
      const province = pickRandom(data.provinces, random);
      const city = pickRandom(province.cities, random);
      const street = pickRandom(data.streets, random);
      const streetNum = randomInt(1, 200, random);
      const suffix = pickRandom(data.suffixes, random);
      const dongSuffix = pickRandom(data.dongSuffixes, random);
      const dongNum = randomInt(1, 50, random);
      const dongName = pickRandom(['신천', '삼성', '역삼', '서초', '잠실', '청담', '반포', '도곡', '대치', '개포', '수서', '일원', '방배', '논현', '압구정',
        '홍대', '연희', '합정', '망원', '상수', '이촌', '한남', '옥수', '왕십리', '성수', '자양', '구의', '신사', '가락', '방이'], random);
      const hoNum = randomInt(101, 2003, random);
      const postal5 = String(randomInt(10000, 99999, random));
      return `(${postal5}) ${province.name} ${city} ${dongName}${dongSuffix} ${street} ${streetNum}길 ${randomInt(1, 50, random)}, ${suffix} ${dongNum}${dongSuffix} ${hoNum}호`;
    }
    return '';
  }

  function initGeneratedTools(options) {
    const {
      genPwdBtn,
      pwdResult,
      genNameBtn,
      nameResult,
      genBdayBtn,
      bdayResult,
      genAddrBtn,
      addrResult,
      getFillActionLabel,
      getPasswordFillActions,
      getNameFillActions,
      getBirthdayFillActions,
      getAddressFillActions,
      updateGeneratedProfile,
      sendToActivePage,
      bindFillPreview,
      copyToClipboard,
      showMessage,
      fillProfileMessage,
      dismissGeneratedResult,
      appendGeneratedHistory,
      getGeneratedResultAutoCloseSeconds
    } = options;
    const resultTimerState = new Map();

    function recordGeneratedHistory(entry) {
      if (typeof appendGeneratedHistory !== 'function') {
        return;
      }
      Promise.resolve(appendGeneratedHistory(entry)).catch((error) => {
        console.error('保存生成历史失败', error);
      });
    }

    function clearToolResultState(container) {
      const timerState = resultTimerState.get(container);
      if (timerState) {
        window.clearInterval(timerState.intervalId);
        resultTimerState.delete(container);
      }
    }

    function startResultCountdown(container, countdownEl, dismissKind) {
      clearToolResultState(container);
      if (!countdownEl || typeof dismissGeneratedResult !== 'function' || !dismissKind) {
        return;
      }
      const totalSeconds = Math.max(1, Number.parseInt(getGeneratedResultAutoCloseSeconds?.(), 10) || 30);
      let remainingSeconds = totalSeconds;
      countdownEl.textContent = `${remainingSeconds}s`;
      countdownEl.classList.remove('hidden');
      const intervalId = window.setInterval(() => {
        remainingSeconds -= 1;
        if (remainingSeconds <= 0) {
          clearToolResultState(container);
          dismissGeneratedResult(dismissKind);
          return;
        }
        countdownEl.textContent = `${remainingSeconds}s`;
      }, 1000);
      resultTimerState.set(container, { intervalId });
    }

    function showToolResult(container, text, resultOptions = {}) {
      clearToolResultState(container);
      container.classList.remove('hidden');
      container.innerHTML = '';

      const span = document.createElement('span');
      span.className = 'tool-result-text';
      span.textContent = text;
      container.appendChild(span);

      const actions = document.createElement('div');
      actions.className = 'tool-result-actions';

      let countdownEl = null;
      if (resultOptions.dismissKind) {
        countdownEl = document.createElement('span');
        countdownEl.className = 'tool-result-timer';
        actions.appendChild(countdownEl);
      }

      const fillActions = Array.isArray(resultOptions.fillActions) && resultOptions.fillActions.length
        ? resultOptions.fillActions
        : (resultOptions.fillKind
          ? [{
              kind: resultOptions.fillKind,
              value: resultOptions.fillValue || text,
              label: resultOptions.fillLabel || getFillActionLabel(resultOptions.fillKind),
              title: resultOptions.fillTitle || getFillActionLabel(resultOptions.fillKind)
            }]
          : []);

      fillActions.forEach((action) => {
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.className = 'tool-result-action';
        fillBtn.title = action.title || action.label || getFillActionLabel(action.kind);
        fillBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/><path d="M5 3h14"/></svg><span>${action.label || getFillActionLabel(action.kind)}</span>`;
        fillBtn.onclick = async () => {
          try {
            const fillValue = action.value || text;
            await sendToActivePage({
              type: 'fill-value',
              kind: action.kind,
              value: fillValue
            });
            copyToClipboard(fillValue, fillBtn);
          } catch (error) {
            showMessage(fillProfileMessage, `填充失败: ${error.message}`, 'error');
          }
        };
        bindFillPreview(fillBtn, { kind: action.kind });
        actions.appendChild(fillBtn);
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'icon-btn';
      copyBtn.title = '复制';
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      copyBtn.onclick = () => copyToClipboard(text, copyBtn);
      actions.appendChild(copyBtn);

      if (resultOptions.dismissKind) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'icon-btn tool-result-close-btn';
        closeBtn.title = '关闭';
        closeBtn.setAttribute('aria-label', '关闭');
        closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
        closeBtn.onclick = () => {
          clearToolResultState(container);
          dismissGeneratedResult(resultOptions.dismissKind);
        };
        actions.appendChild(closeBtn);
      }

      container.appendChild(actions);
      if (resultOptions.dismissKind) {
        startResultCountdown(container, countdownEl, resultOptions.dismissKind);
      }
    }

    genPwdBtn.addEventListener('click', () => {
      const len = Math.max(4, Math.min(128, parseInt(document.getElementById('pwd-length').value, 10) || 16));
      const useUpper = document.getElementById('pwd-upper').checked;
      const useLower = document.getElementById('pwd-lower').checked;
      const useDigit = document.getElementById('pwd-digit').checked;
      const useSpecial = document.getElementById('pwd-special').checked;
      const noAmbig = document.getElementById('pwd-no-ambig').checked;

      const password = generatePassword(len, useUpper, useLower, useDigit, useSpecial, noAmbig);

      updateGeneratedProfile({ password, confirmPassword: password });
      recordGeneratedHistory({ kind: 'password', value: password });
      showToolResult(pwdResult, password, {
        fillActions: getPasswordFillActions(password, password),
        dismissKind: 'password'
      });
    });

    genNameBtn.addEventListener('click', () => {
      const genderSelection = document.getElementById('name-gender').value;
      const region = document.getElementById('name-region').value;
      const { fullName, firstName, lastName } = generateName({
        region,
        gender: genderSelection,
        zhTwoCharacterProbability: 0.6
      });

      updateGeneratedProfile({ fullName, firstName, lastName });
      recordGeneratedHistory({ kind: 'name', value: fullName });
      showToolResult(nameResult, fullName, {
        fillActions: getNameFillActions(fullName, firstName, lastName),
        dismissKind: 'name'
      });
    });

    genBdayBtn.addEventListener('click', () => {
      const fillMode = document.getElementById('bday-fill-mode')?.value === 'age' ? 'age' : 'date';
      let minYear = parseInt(document.getElementById('bday-min-year').value, 10) || 1980;
      let maxYear = parseInt(document.getElementById('bday-max-year').value, 10) || 2005;
      if (minYear > maxYear) {
        [minYear, maxYear] = [maxYear, minYear];
      }

      const { date: dateStr, age } = generateBirthday({ minYear, maxYear });
      const ageStr = String(age);

      updateGeneratedProfile(fillMode === 'age'
        ? { birthday: '', age: ageStr }
        : { birthday: dateStr, age: '' });
      recordGeneratedHistory(fillMode === 'age'
        ? { kind: 'age', value: ageStr }
        : { kind: 'birthday', value: dateStr });
      showToolResult(bdayResult, fillMode === 'age' ? `${ageStr} 岁` : `${dateStr}（${age} 岁）`, {
        fillActions: getBirthdayFillActions(
          fillMode === 'age' ? '' : dateStr,
          fillMode === 'age' ? ageStr : ''
        ),
        dismissKind: 'birthday'
      });
    });

    genAddrBtn.addEventListener('click', () => {
      const region = document.getElementById('addr-region')?.value || 'zh';
      const address = generateAddress({ region });

      if (!address) return;

      updateGeneratedProfile({ address });
      recordGeneratedHistory({ kind: 'address', value: address });
      showToolResult(addrResult, address, {
        fillActions: getAddressFillActions(address),
        dismissKind: 'address'
      });
    });

    return {
      showToolResult,
      clearToolResultState
    };
  }

  window.PopupToolGenerators = {
    initGeneratedTools,
    generatePassword,
    generateName,
    generateBirthday,
    generateAddress,
    NAME_DATA
  };
})();
