The Open University (OU) dataset is an open database containing student demographic and click-stream interaction with the virtual learning platform. The available data are structured in different CSV files. You can find more information about the original dataset at the following link: https://analyse.kmi.open.ac.uk/open_dataset.

We extracted a subset of the original dataset that focuses on student information. 25,819 records were collected referring to a specific student, course and semester. Each record is described by the following 20 attributes:  code_module, code_presentation, gender, highest_education, imd_band, age_band, num_of_prev_attempts, studies_credits, disability, resource, homepage, forum, glossary, outcontent, subpage, url, outcollaborate, quiz, AvgScore, count.

Two target classes were considered, namely Fail and Pass, combining the original four classes (Fail and Withdrawn and Pass and Distinction, respectively). The final_result attribute contains the target values.

All features have been converted to numbers for automatic processing.

Below is the mapping used to convert categorical values to numeric:

code_module: 'AAA'=0, 'BBB'=1, 'CCC'=2, 'DDD'=3, 'EEE'=4, 'FFF'=5, 'GGG'=6
code_presentation: '2013B'=0, '2013J'=1, '2014B'=2, '2014J'=3
gender: 'F'=0, 'M'=1
highest_education: 'No_Formal_quals'=0, 'Post_Graduate_Qualification'=1, 'HE_Qualification'=2, 'Lower_Than_A_Level'=3, 'A_level_or_Equivalent'=4
IMBD_band: 'unknown'=0, 'between_0_and_10_percent'=1, 'between_10_and_20_percent'=2, 'between_20_and_30_percent'=3, 'between_30_and_40_percent'=4, 'between_40_and_50_percent'=5, 'between_50_and_60_percent'=6, 'between_60_and_70_percent'=7, 'between_70_and_80_percent'=8, 'between_80_and_90_percent'=9, 'between_90_and_100_percent'=10
age_band: 'between_0_and_35'=0, 'between_35_and_55'=1, 'higher_than_55'=2
disability: 'N'=0, 'Y'=1
student's outcome: 'Fail'=0, 'Pass'=1