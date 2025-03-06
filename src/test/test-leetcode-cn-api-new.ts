const axios = require('axios');

async function testLeetCodeCNAPI() {
  try {
    // 尝试新的API结构
    const query = `
      query userProfileUserQuestionProgress($userSlug: String!) {
        userProfileUserQuestionProgress(userSlug: $userSlug) {
          numAcceptedQuestions {
            difficulty
            count
          }
          numFailedQuestions {
            difficulty
            count
          }
          numUntouchedQuestions {
            difficulty
            count
          }
        }
      }
    `;

    const variables = { userSlug: 'lucky845' };
    console.log('Testing LeetCode CN API with new structure...');
    const response = await axios.post('https://leetcode.cn/graphql/', {
      query,
      variables
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://leetcode.cn/'
      },
      timeout: 10000
    });

    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('Error testing API:', error.message);
    if (error.response) {
      console.error('Error response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testLeetCodeCNAPI();